var CONTENT_SCRIPT = (function () {
    var temp_issues = [], is_log = true,
        statistical_workload_config = {active: false},
        statistical_overdue_config = {active: false};
    return {
        // 初始化
        init: function () {
            chrome.runtime.onMessage.addListener(CONTENT_SCRIPT.on_message_listener);
        },
        // 接收来自后台的消息
        on_message_listener: function (receive, sender, sendResponse) {
            if (is_log) console.log('receive', receive);
            var reply = 'received';

            if (receive.cmd) {
                if (receive.cmd === 'check_items') {
                    reply = {
                        enable_statistical_workload: !statistical_workload_config.active && !statistical_overdue_config.active,
                        enable_statistical_overdue: !statistical_workload_config.active && !statistical_overdue_config.active
                    };
                } else if (receive.cmd === 'statistical_workload') {
                    CONTENT_SCRIPT.statistical_workload();
                } else if (receive.cmd === 'show_workload_sum') {
                    CONTENT_SCRIPT.show_workload_sum();
                } else if (receive.cmd === 'refresh_table') {
                    $('.refresh-table')[0].click();
                } else if (receive.cmd === 'statistical_overdue') {
                    CONTENT_SCRIPT.statistical_overdue();
                }
            }

            sendResponse(reply);
            if (is_log) console.log('reply', reply);
        },
        // 查询JIRA工单（由于JIRA有条数限制，本函数会递归查询所有分页数据后再callback）
        jira_search: function (params, callback) {
            var jql = params.jql || '';
            var fields = params.fields || '';
            var start = params.start || 0;
            temp_issues = [];

            if (!jql) {
                console.error('jql is null');
                return;
            }
            if (!fields) {
                console.error('fields is null');
                return;
            }

            $.ajax({
                url: "http://jira.51zxtx.com/rest/api/2/search",
                type: "GET",
                data: {
                    jql: jql,
                    fields: fields,
                    startAt: start,
                    maxResults: 1000
                },
                dataType: 'JSON',
                success: function (data) {
                    if (data.issues.length > 0) {
                        Array.prototype.push.apply(temp_issues, data.issues);
                    }

                    if (temp_issues.length < data.total) {
                        CONTENT_SCRIPT.jira_search({
                            jql: jql,
                            fields: fields,
                            start: temp_issues.length
                        }, callback);
                    } else {
                        if (callback) callback(temp_issues);
                    }
                }
            });
        },
        // 显示加载界面
        show_loading: function () {
            $("#jira_toolkit__aui_blanket").remove();
            $("#jira_toolkit__loading_background").remove();
            $("#jira_toolkit__loading_indicator").remove();
            var html =
                '<div id="jira_toolkit__aui_blanket" class="aui-blanket" aria-hidden="false"></div>' +
                '<div id="jira_toolkit__loading_background"  class="jira-page-loading-background" aria-hidden="false"></div>' +
                '<div id="jira_toolkit__loading_indicator"  class="jira-page-loading-indicator" aria-hidden="false"></div>';
            $('body').append(html);
        },
        // 隐藏加载界面
        hide_loading: function () {
            $("#jira_toolkit__aui_blanket").remove();
            $("#jira_toolkit__loading_background").remove();
            $("#jira_toolkit__loading_indicator").remove();
        },
        // 统计未完成工作量
        statistical_workload: function () {
            // 显示加载界面
            CONTENT_SCRIPT.show_loading();
            // 更新状态
            statistical_workload_config.active = true;
            // 查询数据
            CONTENT_SCRIPT.jira_search(
                {
                    jql: "issuetype in standardIssueTypes() AND status in (确认中, 设计中, 排期中, 待开发, 开发中, 待测试, 测试中, 待验收, 验收中, 待发布, 发布中)",
                    fields: "customfield_10327,customfield_10400,customfield_10328,customfield_10401,customfield_10329,customfield_10402,customfield_10330,customfield_10318,customfield_10331,customfield_10319,customfield_10332,customfield_10405,customfield_10333,customfield_10407,status,fixVersions"
                },
                function (issues) {
                    // 处理数据
                    var data = CONTENT_SCRIPT.statistical_workload__data_process(issues);
                    // 展示数据
                    CONTENT_SCRIPT.statistical_workload__data_show(data);
                    // 隐藏加载界面
                    CONTENT_SCRIPT.hide_loading();
                }
            );
        },
        // 统计未完成工作量-处理数据
        statistical_workload__data_process: function (issues) {
            var data = {};
            // 设置每一项的默认数据格式
            var set_item_default_data = function (user) {
                if (!user) {
                    user = {
                        key: 'EMPTY',
                        displayName: '<span style="color:red">未分配</span>'
                    };
                }
                if (!data.hasOwnProperty(user.key)) {
                    data[user.key] = {
                        key: user.key,
                        display_name: user.displayName,
                        no_workload_count: {value: 0, issues: []},
                        workload_total: {value: 0, issues: []},
                        workload_main: {value: 0, issues: []},
                        workload_common: {value: 0, issues: []}
                    };
                }
            };
            // 数据更新 指定字段
            var update_item_data_field = function (user, workload, item, field_name) {
                var field_val = data[user.key][field_name];
                if ($.inArray(item.key, field_val.issues) === -1) {
                    switch (field_name) {
                        case 'no_workload_count':
                            field_val.value++;
                            field_val.issues.push(item.key);
                            break;
                        case 'workload_total':
                        case 'workload_main':
                        case 'workload_common':
                            field_val.value = CONTENT_SCRIPT.float_add(field_val.value, workload);
                            field_val.issues.push(item.key);
                            break;
                    }
                }
            };
            // 数据更新
            var update_item_data = function (user, workload, item) {
                if (!user) {
                    user = {
                        key: 'EMPTY',
                        displayName: '<span style="color:red">未分配</span>'
                    };
                }
                if (!workload) {
                    update_item_data_field(user, workload, item, 'no_workload_count');
                } else {
                    update_item_data_field(user, workload, item, 'workload_total');
                    if (item.fields.fixVersions.length <= 0) {
                        update_item_data_field(user, workload, item, 'workload_common');
                    } else {
                        update_item_data_field(user, workload, item, 'workload_main');
                    }
                }
            };

            $.each(issues, function (idx, item) {
                var user, workload;
                // 工单确认（单一组负责）
                if ($.inArray(item.fields.status.name, ['确认中']) !== -1) {
                    user = item.fields.customfield_10327; // 确认负责人
                    workload = item.fields.customfield_10400; // 确认预估消耗
                    set_item_default_data(user);
                    update_item_data(user, workload, item);
                }
                // 方案设计（单一组负责，各组长参与）
                if ($.inArray(item.fields.status.name, ['设计中']) !== -1) {
                    user = item.fields.customfield_10328; // 设计负责人
                    workload = item.fields.customfield_10401; // 设计预估消耗
                    set_item_default_data(user);
                    update_item_data(user, workload, item);
                }
                // 版本排期（各组长参与）
                if ($.inArray(item.fields.status.name, ['排期中']) !== -1) {
                    // user = item.fields.customfield_10329; // 排期负责人
                    // workload = item.fields.customfield_10402; // 排期预估消耗
                    // set_item_default_data(user);
                    // update_item_data(user, workload, item);
                }
                // 项目开发（单一组负责）
                if ($.inArray(item.fields.status.name, ['待开发', '开发中']) !== -1) {
                    user = item.fields.customfield_10330; // 开发负责人
                    workload = item.fields.customfield_10318; // 开发预估消耗
                    set_item_default_data(user);
                    update_item_data(user, workload, item);
                }
                // 内部测试（单一组负责）
                if ($.inArray(item.fields.status.name, ['待开发', '开发中', '待测试', '测试中']) !== -1) {
                    user = item.fields.customfield_10331; // 测试负责人
                    workload = item.fields.customfield_10319; // 测试预估消耗
                    set_item_default_data(user);
                    update_item_data(user, workload, item);
                }
                // 用户验收（单一组负责，工作量少可忽略）
                if ($.inArray(item.fields.status.name, ['待开发', '开发中', '待测试', '测试中', '待验收', '验收中']) !== -1) {
                    // user = item.fields.customfield_10332; // 验收负责人
                    // workload = item.fields.customfield_10405; // 验收预估消耗
                    // set_item_default_data(user);
                    // update_item_data(user, workload, item);
                }
                // 版本发布（单一组负责，工作量少可忽略）
                if ($.inArray(item.fields.status.name, ['待开发', '开发中', '待测试', '测试中', '待验收', '验收中', '待发布', '发布中']) !== -1) {
                    // user = item.fields.customfield_10333; // 验收负责人
                    // workload = item.fields.customfield_10407; // 验收预估消耗
                    // set_item_default_data(user);
                    // update_item_data(user, workload, item);
                }
            });

            return data;
        },
        // 统计未完成工作量-展示数据
        statistical_workload__data_show: function (data) {
            var dialog_menu = '',
                dialog_pane = '';
            $.each(data, function (key, val) {
                var no_workload_count_link = 'http://jira.51zxtx.com/issues/?filter=12603&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E7%A1%AE%E8%AE%A4%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E8%AE%BE%E8%AE%A1%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E5%BC%80%E5%8F%91%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E6%B5%8B%E8%AF%95%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20EMPTY)%0A)%20%0AORDER%20BY%20status%20DESC';
                var workload_total_link = 'http://jira.51zxtx.com/issues/?filter=12603&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E7%A1%AE%E8%AE%A4%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E8%AE%BE%E8%AE%A1%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E5%BC%80%E5%8F%91%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E6%B5%8B%E8%AF%95%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%0A)%20%0AORDER%20BY%20status%20DESC';
                var workload_main_link = 'http://jira.51zxtx.com/issues/?filter=12603&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E7%A1%AE%E8%AE%A4%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E8%AE%BE%E8%AE%A1%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E5%BC%80%E5%8F%91%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E6%B5%8B%E8%AF%95%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%0A)%20%0AAND%20fixVersion%20IS%20NOT%20EMPTY%0AORDER%20BY%20status%20DESC';
                var workload_common_link = 'http://jira.51zxtx.com/issues/?filter=12603&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E7%A1%AE%E8%AE%A4%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E8%AE%BE%E8%AE%A1%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E5%BC%80%E5%8F%91%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%20OR%20%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + key + '%20AND%20%E6%B5%8B%E8%AF%95%E9%A2%84%E4%BC%B0%E6%B6%88%E8%80%97%20IS%20NOT%20EMPTY)%0A)%20%0AAND%20fixVersion%20IS%20EMPTY%0AORDER%20BY%20status%20DESC';

                dialog_menu += '<li><button data-key="' + key + '" class="dialog-menu-item">' + val.display_name + '</button></li>';
                dialog_pane +=
                    '<div data-key="' + key + '" class="aui-item dialog-pane hidden">' +
                    '    <form class="aui">' +
                    '        <div class="form-body">' +
                    '            <div class="action-description">所有未完成工单的工作量情况</div>' +
                    '            <div class="issue-link-oauth-toggle only-local-server">' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><a target="_blank" href="' + no_workload_count_link + '">' + val.no_workload_count.value + '</a> 个</span>' +
                    '                    <label>无工作量工单数：</label>' +
                    '                    <div class="description">&nbsp;</div>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><a target="_blank" href="' + workload_total_link + '">' + val.workload_total.value + '</a> 人天</span>' +
                    '                    <label>总工作量：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><a target="_blank" href="' + workload_main_link + '">' + val.workload_main.value + '</a> 人天</span>' +
                    '                    <label>主版本工作量：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><a target="_blank" href="' + workload_common_link + '">' + val.workload_common.value + '</a> 人天</span>' +
                    '                    <label>日常工作量：</label>' +
                    '                </div>' +
                    '            </div>' +
                    '        </div>' +
                    '        <div class="buttons-container form-footer">' +
                    '            <div class="buttons">' +
                    '                <span class="icon throbber"></span>' +
                    '                <a class="aui-button aui-button-link cancel" href="#">关闭</a>' +
                    '            </div>' +
                    '        </div>' +
                    '    </form>' +
                    '</div>';
            });

            var html =
                '<div id="jira_toolkit__statistical_workload_aui_blanket" class="aui-blanket" aria-hidden="false"></div>' +
                '<div id="jira_toolkit__statistical_workload" class="jira-dialog box-shadow jira-dialog-open popup-width-large jira-dialog-content-ready">' +
                '    <div class="jira-dialog-heading"><h2 title="统计未完成工作量">统计未完成工作量</h2></div>' +
                '    <div class="jira-dialog-content">' +
                '        <div class="aui-group">' +
                '            <div class="aui-item dialog-menu-group">' +
                '                <ul class="dialog-menu">' + dialog_menu + '</ul>' +
                '            </div>' +
                '        ' + dialog_pane +
                '        </div>' +
                '    </div>' +
                '</div>';
            $('body').append(html);

            $('#jira_toolkit__statistical_workload button.dialog-menu-item').on('click', function () {
                $(this).parent().parent().find('.dialog-menu-item').removeClass('selected');
                $(this).addClass('selected');
                $('#jira_toolkit__statistical_workload .dialog-pane').addClass('hidden');
                $('#jira_toolkit__statistical_workload .dialog-pane[data-key=' + $(this).attr('data-key') + ']').removeClass('hidden');
            });
            $('#jira_toolkit__statistical_workload a.cancel').on('click', function () {
                $("#jira_toolkit__statistical_workload_aui_blanket").remove();
                $("#jira_toolkit__statistical_workload").remove();
                statistical_workload_config.active = false;
            });
            $('#jira_toolkit__statistical_workload button.dialog-menu-item:first').click();
        },
        // 浮点相加
        float_add: function (arg1, arg2) {
            arg1 = parseFloat(arg1);
            arg2 = parseFloat(arg2);
            var multiple = Math.pow(10, 10);
            return Math.round(arg1 * multiple + arg2 * multiple) / multiple;
        },
        // 显示工作量合计
        show_workload_sum: function (count) {
            // 在列表页面且DOM加载完毕才执行
            var issue_table = $('#issuetable');
            var results_count_total = $('.results-count-total');
            if (issue_table.length <= 0 || results_count_total.length <= 0 ||
                parseInt($(results_count_total[0]).text()) < issue_table.find('tbody tr').length) {
                if (count) {
                    count++;
                } else {
                    count = 0;
                }
                if (count > 200) return;
                setTimeout(function () {
                    CONTENT_SCRIPT.show_workload_sum(count);
                }, 10);
            }
            // 移除原有的html
            issue_table.find('tbody .jira_toolkit__workload_sum').remove();
            // 需要展示合计值的列
            var field_list_sum = [
                'customfield_10400', // 确认预估消耗
                'customfield_10314', // 确认实际消耗
                'customfield_10401', // 设计预估消耗
                'customfield_10315', // 设计实际消耗
                'customfield_10402', // 排期预估消耗
                'customfield_10325', // 排期实际消耗
                'customfield_10318', // 开发预估消耗
                'customfield_10403', // 开发实际消耗
                'customfield_10319', // 测试预估消耗
                'customfield_10404', // 测试实际消耗
                'customfield_10405', // 验收预估消耗
                'customfield_10406', // 验收实际消耗
                'customfield_10407', // 发布预估消耗
                'customfield_10409', // 发布实际消耗
                'customfield_10309' // 子任务预估消耗
            ];
            // 组装html
            var row_html = '<tr class="issuerow jira_toolkit__workload_sum">';
            var has_sum = false;
            $.each(issue_table.find('.rowHeader th'), function (idx, th) {
                var field_name = $(th).attr('data-id');
                if ($.inArray(field_name, field_list_sum) !== -1) {
                    var sum = 0;
                    $.each(issue_table.find('tbody td.' + field_name), function (index, td) {
                        var value = $.trim($(td).text());
                        if (value) {
                            sum = CONTENT_SCRIPT.float_add(sum, value);
                        }
                    });

                    row_html += '<td>' + sum + '</td>';
                    has_sum = true;
                } else {
                    row_html += '<td>&nbsp;</td>';
                }
            });
            row_html += '</tr>';
            // 插入html到页面
            if (has_sum) {
                issue_table.find('tbody').append(row_html);
                issue_table.find('tbody').prepend(row_html);
            }
        },
        // 设置是否打印日志
        set_log_flag: function (flag) {
            is_log = flag;
        },
        // 统计逾期工单
        statistical_overdue: function () {
            // 显示加载界面
            CONTENT_SCRIPT.show_loading();
            // 更新状态
            statistical_overdue_config.active = true;
            // 查询数据
            CONTENT_SCRIPT.jira_search(
                {
                    jql: "issuetype in standardIssueTypes() AND status in (确认中, 设计中, 排期中, 待开发, 开发中, 测试未通过, 待测试, 测试中, 待验收, 验收中, 待发布, 发布中)",
                    fields: "customfield_10327,customfield_10310,customfield_10328,customfield_10312,customfield_10329,customfield_10324,customfield_10330,customfield_10316,customfield_10331,customfield_10317,customfield_10332,customfield_10326,customfield_10333,customfield_10408,status,fixVersions"
                },
                function (issues) {
                    // 处理数据
                    var data = CONTENT_SCRIPT.statistical_overdue__data_process(issues);
                    // 展示数据
                    CONTENT_SCRIPT.statistical_overdue__data_show(data);
                    // 隐藏加载界面
                    CONTENT_SCRIPT.hide_loading();
                }
            );
        },
        // 统计逾期工单-处理数据
        statistical_overdue__data_process: function (issues) {
            var data = {};
            // 设置用户的默认数据
            var set_user_default_data = function (user) {
                if (!user) {
                    user = {
                        key: 'EMPTY',
                        displayName: '<span style="color:red">未分配</span>'
                    };
                }
                if (!data.hasOwnProperty(user.key)) {
                    data[user.key] = {
                        // 用户信息
                        user_info: {
                            key: user.key,
                            display_name: user.displayName,
                        },
                        // 多个阶段都逾期的工单
                        multiple_stage: {
                            count: 0,
                            lists: {
                                // 'TEST-1': ['develop', 'test']
                            }
                        },
                        // 没有设置期限的工单
                        no_deadline: [],
                        // 有设置期限且逾期的工单
                        have_deadline: {
                            // 所有工单
                            total: {
                                count: 0,
                                lists: {
                                    // 'TEST-1': ['develop', 'test']
                                }
                            },
                            // 确认阶段逾期的工单
                            confirm: [],
                            // 设计阶段逾期的工单
                            design: [],
                            // 排期阶段逾期的工单
                            schedule: [],
                            // 开发阶段逾期的工单
                            develop: {
                                // 所有工单
                                total: [],
                                // 主板本工单
                                main: [],
                                // 日常工单
                                common: []
                            },
                            // 测试阶段逾期的工单
                            test: {
                                // 所有工单
                                total: [],
                                // 主板本工单
                                main: [],
                                // 日常工单
                                common: []
                            },
                            // 验收阶段逾期的工单
                            check: {
                                // 所有工单
                                total: [],
                                // 主板本工单
                                main: [],
                                // 日常工单
                                common: []
                            },
                            // 发布阶段逾期的工单
                            release: {
                                // 所有工单
                                total: [],
                                // 主板本工单
                                main: [],
                                // 日常工单
                                common: []
                            }
                        },
                    };
                }
            };
            // 更新用户数据
            var update_user_data = function (user, deadline, stage, issue) {
                if (!user) {
                    user = {
                        key: 'EMPTY',
                        displayName: '<span style="color:red">未分配</span>'
                    };
                }
                var user_data = data[user.key];

                if (!deadline) {
                    if ($.inArray(issue.key, user_data.no_deadline) === -1) {
                        user_data.no_deadline.push(issue.key);
                    }
                } else if (new Date(deadline).getTime() <= new Date().getTime()) {
                    var have_deadline = user_data.have_deadline;
                    if (!have_deadline.total.lists.hasOwnProperty(issue.key)) {
                        have_deadline.total.count++;
                        have_deadline.total.lists[issue.key] = [stage];
                    } else {
                        have_deadline.total.lists[issue.key].push(stage);

                        if (!user_data.multiple_stage.lists.hasOwnProperty(issue.key)) user_data.multiple_stage.count++;
                        user_data.multiple_stage.lists[issue.key] = have_deadline.total.lists[issue.key];
                    }

                    switch (stage) {
                        case 'confirm':
                        case 'design':
                        case 'schedule':
                            have_deadline[stage].push(issue.key);
                            break;
                        case 'develop':
                        case 'test':
                        case 'check':
                        case 'release':
                            have_deadline[stage].total.push(issue.key);
                            if (issue.fields.fixVersions.length <= 0) {
                                have_deadline[stage].common.push(issue.key);
                            } else {
                                have_deadline[stage].main.push(issue.key);
                            }
                            break;
                    }
                }
            };
            // 循环处理
            $.each(issues, function (idx, issue) {
                var user, deadline;
                // 工单确认（单一组负责）
                if ($.inArray(issue.fields.status.name, ['确认中']) !== -1) {
                    user = issue.fields.customfield_10327; // 确认负责人
                    deadline = issue.fields.customfield_10310; // 确认期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'confirm', issue);
                }
                // 方案设计（单一组负责，各组长参与）
                if ($.inArray(issue.fields.status.name, ['设计中']) !== -1) {
                    user = issue.fields.customfield_10328; // 设计负责人
                    deadline = issue.fields.customfield_10312; // 设计期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'design', issue);
                }
                // 版本排期（各组长参与）
                if ($.inArray(issue.fields.status.name, ['排期中']) !== -1) {
                    user = issue.fields.customfield_10329; // 排期负责人
                    deadline = issue.fields.customfield_10324; // 排期期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'schedule', issue);
                }
                // 项目开发（单一组负责）
                if ($.inArray(issue.fields.status.name, ['待开发', '开发中', '测试未通过']) !== -1) {
                    user = issue.fields.customfield_10330; // 开发负责人
                    deadline = issue.fields.customfield_10316; // 开发期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'develop', issue);
                }
                // 内部测试（单一组负责）
                if ($.inArray(issue.fields.status.name, ['待开发', '开发中', '测试未通过', '待测试', '测试中']) !== -1) {
                    user = issue.fields.customfield_10331; // 测试负责人
                    deadline = issue.fields.customfield_10317; // 测试期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'test', issue);
                }
                // 用户验收（单一组负责，工作量少可忽略）
                if ($.inArray(issue.fields.status.name, ['待开发', '开发中', '测试未通过', '待测试', '测试中', '待验收', '验收中']) !== -1) {
                    user = issue.fields.customfield_10332; // 验收负责人
                    deadline = issue.fields.customfield_10326; // 验收期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'check', issue);
                }
                // 版本发布（单一组负责，工作量少可忽略）
                if ($.inArray(issue.fields.status.name, ['待开发', '开发中', '测试未通过', '待测试', '测试中', '待验收', '验收中', '待发布', '发布中']) !== -1) {
                    user = issue.fields.customfield_10333; // 发布负责人
                    deadline = issue.fields.customfield_10408; // 发布期限
                    set_user_default_data(user);
                    update_user_data(user, deadline, 'release', issue);
                }
            });

            if (is_log) console.log('statistical_overdue_data', data);
            return data;
        },
        // 统计逾期工单-展示数据
        statistical_overdue__data_show: function (data) {
            var dialog_menu = '',
                dialog_pane = '';
            $.each(data, function (user_key, user_data) {
                var link_no_deadline = 'http://jira.51zxtx.com/issues/?filter=12604&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E6%8E%92%E6%9C%9F%E4%B8%AD)%20AND%20%E6%8E%92%E6%9C%9F%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD)%20AND%20%E9%AA%8C%E6%94%B6%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20IS%20EMPTY)%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD%2C%E5%BE%85%E5%8F%91%E5%B8%83%2C%E5%8F%91%E5%B8%83%E4%B8%AD)%20AND%20%E5%8F%91%E5%B8%83%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20IS%20EMPTY)%0A)%0AORDER%20BY%20status%20ASC';
                var link_total = 'http://jira.51zxtx.com/issues/?filter=12604&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%0A%20%20%20%20(status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E6%8E%92%E6%9C%9F%E4%B8%AD)%20AND%20%E6%8E%92%E6%9C%9F%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD)%20AND%20%E9%AA%8C%E6%94%B6%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%3C%3Dnow())%20OR%0A%20%20%20%20(status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD%2C%E5%BE%85%E5%8F%91%E5%B8%83%2C%E5%8F%91%E5%B8%83%E4%B8%AD)%20AND%20%E5%8F%91%E5%B8%83%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%3C%3Dnow())%0A)%0AORDER%20BY%20status%20ASC';
                var link_confirm = 'http://jira.51zxtx.com/issues/?filter=12606&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E7%A1%AE%E8%AE%A4%E4%B8%AD)%20AND%20%E7%A1%AE%E8%AE%A4%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E7%A1%AE%E8%AE%A4%E6%9C%9F%E9%99%90%20ASC';
                var link_design = 'http://jira.51zxtx.com/issues/?filter=12607&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E8%AE%BE%E8%AE%A1%E4%B8%AD)%20AND%20%E8%AE%BE%E8%AE%A1%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E8%AE%BE%E8%AE%A1%E6%9C%9F%E9%99%90%20ASC';
                var link_schedule = 'http://jira.51zxtx.com/issues/?filter=12608&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E6%8E%92%E6%9C%9F%E4%B8%AD)%20AND%20%E6%8E%92%E6%9C%9F%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E6%8E%92%E6%9C%9F%E6%9C%9F%E9%99%90%20ASC';
                var link_develop = 'http://jira.51zxtx.com/issues/?filter=12609&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20ASC';
                var link_develop_main = 'http://jira.51zxtx.com/issues/?filter=12609&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%3C%3Dnow()%20AND%20fixVersion%20IS%20NOT%20EMPTY%20)%0AORDER%20BY%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20ASC';
                var link_develop_common = 'http://jira.51zxtx.com/issues/?filter=12609&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87)%20AND%20%E5%BC%80%E5%8F%91%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%3C%3Dnow()%20AND%20fixVersion%20IS%20EMPTY%20)%0AORDER%20BY%20%E5%BC%80%E5%8F%91%E6%9C%9F%E9%99%90%20ASC';
                var link_test = 'http://jira.51zxtx.com/issues/?filter=12610&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%20%0AORDER%20BY%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20ASC';
                var link_test_main = 'http://jira.51zxtx.com/issues/?filter=12610&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%3C%3Dnow()%20%0A%20%20%20%20AND%20fixVersion%20IS%20NOT%20EMPTY%0A)%20%20ORDER%20BY%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20ASC';
                var link_test_common = 'http://jira.51zxtx.com/issues/?filter=12610&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD)%20AND%20%E6%B5%8B%E8%AF%95%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%3C%3Dnow()%20%0A%20%20%20%20AND%20fixVersion%20IS%20EMPTY%0A)%20%20ORDER%20BY%20%E6%B5%8B%E8%AF%95%E6%9C%9F%E9%99%90%20ASC';
                var link_check = 'http://jira.51zxtx.com/issues/?filter=12611&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD)%20AND%20%E9%AA%8C%E6%94%B6%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20ASC';
                var link_check_main = 'http://jira.51zxtx.com/issues/?filter=12611&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD)%20AND%20%E9%AA%8C%E6%94%B6%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%3C%3Dnow()%20%20AND%0A%20%20%20%20fixVersion%20IS%20NOT%20EMPTY%0A)%20%20ORDER%20BY%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20ASC';
                var link_check_common = 'http://jira.51zxtx.com/issues/?filter=12611&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD)%20AND%20%E9%AA%8C%E6%94%B6%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%3C%3Dnow()%20%20AND%0A%20%20%20%20fixVersion%20IS%20EMPTY%0A)%20%20ORDER%20BY%20%E9%AA%8C%E6%94%B6%E6%9C%9F%E9%99%90%20ASC';
                var link_release = 'http://jira.51zxtx.com/issues/?filter=12612&jql=issuetype%20IN%20standardIssueTypes()%20AND%20%0A(%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD%2C%E5%BE%85%E5%8F%91%E5%B8%83%2C%E5%8F%91%E5%B8%83%E4%B8%AD)%20AND%20%E5%8F%91%E5%B8%83%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%3C%3Dnow()%20)%0AORDER%20BY%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20ASC';
                var link_release_main = 'http://jira.51zxtx.com/issues/?filter=12612&jql=issuetype%20IN%20standardIssueTypes()%20AND%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD%2C%E5%BE%85%E5%8F%91%E5%B8%83%2C%E5%8F%91%E5%B8%83%E4%B8%AD)%20AND%20%E5%8F%91%E5%B8%83%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%3C%3Dnow()%20AND%0A%20%20%20%20fixVersion%20IS%20NOT%20EMPTY%0A)%20ORDER%20BY%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20ASC';
                var link_release_common = 'http://jira.51zxtx.com/issues/?filter=12612&jql=issuetype%20IN%20standardIssueTypes()%20AND%20(%20%0A%20%20%20%20status%20IN(%E5%BE%85%E5%BC%80%E5%8F%91%2C%E5%BC%80%E5%8F%91%E4%B8%AD%2C%E6%B5%8B%E8%AF%95%E6%9C%AA%E9%80%9A%E8%BF%87%2C%E5%BE%85%E6%B5%8B%E8%AF%95%2C%E6%B5%8B%E8%AF%95%E4%B8%AD%2C%E5%BE%85%E9%AA%8C%E6%94%B6%2C%E9%AA%8C%E6%94%B6%E4%B8%AD%2C%E5%BE%85%E5%8F%91%E5%B8%83%2C%E5%8F%91%E5%B8%83%E4%B8%AD)%20AND%20%E5%8F%91%E5%B8%83%E8%B4%9F%E8%B4%A3%E4%BA%BA%3D' + user_key + '%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20IS%20NOT%20EMPTY%20AND%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%3C%3Dnow()%20AND%0A%20%20%20%20fixVersion%20IS%20EMPTY%0A)%20ORDER%20BY%20%E5%8F%91%E5%B8%83%E6%9C%9F%E9%99%90%20ASC';

                dialog_menu += '<li><button data-key="' + user_key + '" class="dialog-menu-item">' + user_data.user_info.display_name + '</button></li>';
                dialog_pane +=
                    '<div data-key="' + user_key + '" class="aui-item dialog-pane hidden">' +
                    '    <form class="aui">' +
                    '        <div class="form-body">' +
                    '            <div class="issue-link-oauth-toggle only-local-server">' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span><a target="_blank" href="' + link_no_deadline + '">' + user_data.no_deadline.length + '</a> 个</span>' +
                    '                    </span>' +
                    '                    <label>未设置期限工单数：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span><a target="_blank" href="' + link_total + '">' + user_data.have_deadline.total.count + '</a> 个</span>' +
                    '                        <span class="aui-icon aui-icon-small icon-default aui-iconfont-info ' + (user_data.multiple_stage.count > 0 ? '' : 'hidden') + '" ' +
                    '                              title="当某人负责一个工单的多个阶段且有多个阶段逾期时，此处显示的总数会小于下列各项之和">' +
                    '                        </span>' +
                    '                    </span>' +
                    '                    <label>逾期工单总数：</label>' +
                    '                    <div class="description">&nbsp;</div>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span><a target="_blank" href="' + link_confirm + '">' + user_data.have_deadline.confirm.length + '</a> 个</span>' +
                    '                    </span>' +
                    '                    <label>工单确认阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span><a target="_blank" href="' + link_design + '">' + user_data.have_deadline.design.length + '</a> 个</span>' +
                    '                    </span>' +
                    '                    <label>方案设计阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span><a target="_blank" href="' + link_schedule + '">' + user_data.have_deadline.schedule.length + '</a> 个</span>' +
                    '                    </span>' +
                    '                    <label>版本排期阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span class="jira-toolkit-w20">' +
                    '                            <a target="_blank" href="' + link_develop + '">' + user_data.have_deadline.develop.total.length + '</a> 个' +
                    '                        </span>（主版本' +
                    '                        <a target="_blank" href="' + link_develop_main + '">' + user_data.have_deadline.develop.main.length + '</a>个 日常 ' +
                    '                        <a target="_blank" href="' + link_develop_common + '">' + user_data.have_deadline.develop.common.length + '</a>个）' +
                    '                    </span>' +
                    '                    <label>项目开发阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span class="jira-toolkit-w20">' +
                    '                            <a target="_blank" href="' + link_test + '">' + user_data.have_deadline.test.total.length + '</a> 个' +
                    '                        </span>（主版本' +
                    '                        <a target="_blank" href="' + link_test_main + '">' + user_data.have_deadline.test.main.length + '</a>个 日常 ' +
                    '                        <a target="_blank" href="' + link_test_common + '">' + user_data.have_deadline.test.common.length + '</a>个）' +
                    '                    </span>' +
                    '                    <label>内部测试阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span class="jira-toolkit-w20">' +
                    '                            <a target="_blank" href="' + link_check + '">' + user_data.have_deadline.check.total.length + '</a> 个' +
                    '                        </span>（主版本' +
                    '                        <a target="_blank" href="' + link_check_main + '">' + user_data.have_deadline.check.main.length + '</a>个 日常 ' +
                    '                        <a target="_blank" href="' + link_check_common + '">' + user_data.have_deadline.check.common.length + '</a>个）' +
                    '                    </span>' +
                    '                    <label>用户验收阶段：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value">' +
                    '                        <span class="jira-toolkit-w20">' +
                    '                            <a target="_blank" href="' + link_release + '">' + user_data.have_deadline.release.total.length + '</a> 个' +
                    '                        </span>（主版本' +
                    '                        <a target="_blank" href="' + link_release_main + '">' + user_data.have_deadline.release.main.length + '</a>个 日常 ' +
                    '                        <a target="_blank" href="' + link_release_common + '">' + user_data.have_deadline.release.common.length + '</a>个）' +
                    '                    </span>' +
                    '                    <label>版本发布阶段：</label>' +
                    '                </div>' +
                    '            </div>' +
                    '        </div>' +
                    '        <div class="buttons-container form-footer">' +
                    '            <div class="buttons">' +
                    '                <span class="icon throbber"></span>' +
                    '                <a class="aui-button aui-button-link cancel" href="#">关闭</a>' +
                    '            </div>' +
                    '        </div>' +
                    '    </form>' +
                    '</div>';
            });

            var html =
                '<div id="jira_toolkit__statistical_overdue_aui_blanket" class="aui-blanket" aria-hidden="false"></div>' +
                '<div id="jira_toolkit__statistical_overdue" class="jira-dialog box-shadow jira-dialog-open popup-width-large jira-dialog-content-ready">' +
                '    <div class="jira-dialog-heading"><h2 title="统计逾期工单">统计逾期工单</h2></div>' +
                '    <div class="jira-dialog-content">' +
                '        <div class="aui-group">' +
                '            <div class="aui-item dialog-menu-group">' +
                '                <ul class="dialog-menu">' + dialog_menu + '</ul>' +
                '            </div>' +
                '        ' + dialog_pane +
                '        </div>' +
                '    </div>' +
                '</div>';
            $('body').append(html);

            $('#jira_toolkit__statistical_overdue button.dialog-menu-item').on('click', function () {
                $(this).parent().parent().find('.dialog-menu-item').removeClass('selected');
                $(this).addClass('selected');
                $('#jira_toolkit__statistical_overdue .dialog-pane').addClass('hidden');
                $('#jira_toolkit__statistical_overdue .dialog-pane[data-key=' + $(this).attr('data-key') + ']').removeClass('hidden');
            });
            $('#jira_toolkit__statistical_overdue a.cancel').on('click', function () {
                $("#jira_toolkit__statistical_overdue_aui_blanket").remove();
                $("#jira_toolkit__statistical_overdue").remove();
                statistical_overdue_config.active = false;
            });
            $('#jira_toolkit__statistical_overdue button.dialog-menu-item:first').click();
        }
    };
})();
CONTENT_SCRIPT.init();
