var POPUP = (function () {
    return {
        // 初始化
        init: function () {
            POPUP.check_items();
            $('#statistical_workload').on('click', POPUP.statistical_workload);
            $('#options').on('click', POPUP.open_options_page);
            $('#enable_workload_sum').on('click', POPUP.enable_workload_sum);
            $('#disable_workload_sum').on('click', POPUP.disable_workload_sum);
            $('#statistical_overdue').on('click', POPUP.statistical_overdue);
        },
        // 向content-script发送消息
        send_msg_to_content_script: function (message, callback) {
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                if (tabs.length) {
                    console.log('request', message);
                    chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
                        console.log('response', response);
                        callback(response);
                    });
                }
            })
        },
        // 检查选项是否可用
        check_items: function () {
            POPUP.send_msg_to_content_script({cmd: 'check_items'}, function (response) {
                if (response.enable_statistical_workload) {
                    $('#statistical_workload').removeClass('disabled');
                } else {
                    $('#statistical_workload').addClass('disabled');
                }
                if (response.enable_statistical_overdue) {
                    $('#statistical_overdue').removeClass('disabled');
                } else {
                    $('#statistical_overdue').addClass('disabled');
                }
            });
            chrome.storage.sync.get('enable_workload_sum', function (data) {
                if (data && data.enable_workload_sum === 'Yes') {
                    $('#disable_workload_sum').show();
                    $('#enable_workload_sum').hide();
                } else {
                    $('#enable_workload_sum').show();
                    $('#disable_workload_sum').hide();
                }
            });
        },
        // 统计未完成工作量
        statistical_workload: function () {
            if ($('#statistical_workload').hasClass('disabled')) return;
            POPUP.send_msg_to_content_script({cmd: 'statistical_workload'}, function (response) {
                window.close();
            });
        },
        // 打开配置页面
        open_options_page: function () {
            chrome.tabs.create({url: 'options.html'})
        },
        // 开启工作量合计
        enable_workload_sum: function () {
            chrome.storage.sync.set({enable_workload_sum: 'Yes'});
            POPUP.send_msg_to_content_script({cmd: 'refresh_table'}, function (response) {
            });
            window.close();
        },
        // 关闭工作量合计
        disable_workload_sum: function () {
            chrome.storage.sync.set({enable_workload_sum: 'No'});
            POPUP.send_msg_to_content_script({cmd: 'refresh_table'}, function (response) {
            });
            window.close();
        },
        // 统计逾期工单
        statistical_overdue: function () {
            if ($('#statistical_overdue').hasClass('disabled')) return;
            POPUP.send_msg_to_content_script({cmd: 'statistical_overdue'}, function (response) {
                window.close();
            });
        }
    };
})();
POPUP.init();
