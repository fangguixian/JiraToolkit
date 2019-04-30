var CONTENT_SCRIPT = (function () {
    var temp_issues = [], statistical_workload_config = {active: false};
    return {
        // 初始化
        init: function () {
            chrome.runtime.onMessage.addListener(CONTENT_SCRIPT.on_message_listener);
        },
        // 接收来自后台的消息
        on_message_listener: function (receive, sender, sendResponse) {
            console.log('receive', receive);
            var reply = null;

            if (receive.cmd) {
                if (receive.cmd === 'check_items') {
                    reply = {
                        enable_statistical_workload: !statistical_workload_config.active
                    };
                } else if (receive.cmd === 'statistical_workload') {
                    CONTENT_SCRIPT.statistical_workload();
                }
            }

            if (reply) sendResponse(reply);
            console.log('reply', reply);
        },
        // 查询JIRA工单（由于JIRA有条数限制，本函数会递归查询所有分页数据后再callback）
        statistical_workload__jira_search: function (params, callback) {
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
                        CONTENT_SCRIPT.statistical_workload__jira_search({
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
        // 统计开发工作量-显示加载界面
        statistical_workload__show_loading: function () {
            $("#jira_toolkit__aui_blanket").remove();
            $("#jira_toolkit__loading_background").remove();
            $("#jira_toolkit__loading_indicator").remove();
            var html = `
                <div id="jira_toolkit__aui_blanket" class="aui-blanket" aria-hidden="false"></div>
                <div id="jira_toolkit__loading_background"  class="jira-page-loading-background" aria-hidden="false"></div>
                <div id="jira_toolkit__loading_indicator"  class="jira-page-loading-indicator" aria-hidden="false"></div>
            `;
            $('body').append(html);
        },
        // 统计开发工作量-隐藏加载界面
        statistical_workload__hide_loading: function () {
            $("#jira_toolkit__aui_blanket").remove();
            $("#jira_toolkit__loading_background").remove();
            $("#jira_toolkit__loading_indicator").remove();
        },
        // 统计开发工作量
        statistical_workload: function () {
            // 显示加载界面
            CONTENT_SCRIPT.statistical_workload__show_loading();
            // 更新状态
            statistical_workload_config.active = true;
            // 查询数据
            CONTENT_SCRIPT.statistical_workload__jira_search(
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
                    CONTENT_SCRIPT.statistical_workload__hide_loading();
                }
            );
        },
        // 统计开发工作量-处理数据
        statistical_workload__data_process: function (issues) {
            var data = {};
            var set_item_default_data = function (user) {
                if (!user) {
                    user = {
                        key: 'undistributed',
                        displayName: '未分配'
                    };
                }
                if (!data.hasOwnProperty(user.key)) {
                    data[user.key] = {
                        key: user.key,
                        display_name: user.displayName,
                        no_workload_count: 0,
                        workload_total: 0,
                        workload_main: 0,
                        workload_common: 0
                    };
                }
            };
            var update_item_data = function (user, workload, item) {
                if (!user) {
                    user = {
                        key: 'undistributed',
                        displayName: '未分配'
                    };
                }
                if (!workload) {
                    data[user.key].no_workload_count++;
                } else {
                    data[user.key].workload_total = CONTENT_SCRIPT.float_add(data[user.key].workload_total, workload);
                    if (item.fields.fixVersions.length <= 0) {
                        data[user.key].workload_common = CONTENT_SCRIPT.float_add(data[user.key].workload_common, workload);
                    } else {
                        data[user.key].workload_main = CONTENT_SCRIPT.float_add(data[user.key].workload_main, workload);
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
        // 统计开发工作量-展示数据
        statistical_workload__data_show: function (data) {
            var dialog_menu = '',
                dialog_pane = '';
            $.each(data, function (key, val) {
                dialog_menu += '<li><button data-key="' + key + '" class="dialog-menu-item">' + val.display_name + '</button></li>';
                dialog_pane +=
                    '<div data-key="' + key + '" class="aui-item dialog-pane hidden">' +
                    '    <form class="aui">' +
                    '        <div class="form-body">' +
                    '            <div class="action-description">所有未完成工单的工作量情况</div>' +
                    '            <div class="issue-link-oauth-toggle only-local-server">' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><span>' + val.no_workload_count + '</span> 个</span>' +
                    '                    <label>无工作量工单数：</label>' +
                    '                    <div class="description">&nbsp;</div>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><span>' + val.workload_total + '</span> 人天</span>' +
                    '                    <label>总工作量：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><span>' + val.workload_main + '</span> 人天</span>' +
                    '                    <label>主版本工作量：</label>' +
                    '                </div>' +
                    '                <div class="field-group">' +
                    '                    <span class="field-value"><span>' + val.workload_common + '</span> 人天</span>' +
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
                '    <div class="jira-dialog-heading"><h2 title="工作量详情">工作量详情</h2></div>' +
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
            var r1, r2, m;
            try {
                r1 = arg1.toString().split(".")[1].length
            } catch (e) {
                r1 = 0
            }
            try {
                r2 = arg2.toString().split(".")[1].length
            } catch (e) {
                r2 = 0
            }
            m = Math.pow(10, Math.max(r1, r2));
            return (parseFloat(arg1) * m + parseFloat(arg2) * m) / m;
        }
    };
})();
CONTENT_SCRIPT.init();
