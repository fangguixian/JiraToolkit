var POPUP = (function () {
    return {
        // 初始化
        init: function () {
            POPUP.check_items();
            $('#statistical_workload').on('click', POPUP.statistical_workload);
            $('#options').on('click', POPUP.open_options_page);
        },
        // 向content-script发送消息
        send_msg_to_content_script: function (message, callback) {
            chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
                if (tabs.length) {
                    console.log('request', message);
                    chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
                        console.log('response', response);
                        if (callback) callback(response);
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
            });
        },
        // 统计工作量
        statistical_workload: function () {
            if ($('#statistical_workload').hasClass('disabled')) return;
            POPUP.send_msg_to_content_script({cmd: 'statistical_workload'}, function (response) {
                window.close();
            });
        },
        // 打开配置页面
        open_options_page: function () {
            chrome.tabs.create({url: 'options.html'})
        }
    };
})();
POPUP.init();
