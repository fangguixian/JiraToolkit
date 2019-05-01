var BACK_GROUND = (function () {
    return {
        // 初始化
        init: function () {
            BACK_GROUND.add_rule();
            BACK_GROUND.on_request_completed();
        },
        // 添加页面规则，只有特定页面才显示图标
        add_rule: function () {
            chrome.runtime.onInstalled.addListener(function () {
                chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
                    chrome.declarativeContent.onPageChanged.addRules([{
                        conditions: [new chrome.declarativeContent.PageStateMatcher({pageUrl: {urlContains: 'jira.51zxtx.com'}})],
                        actions: [new chrome.declarativeContent.ShowPageAction()]
                    }]);
                });
            });
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
        // WEB请求监听
        on_request_completed: function () {
            chrome.webRequest.onCompleted.addListener(function (details) {
                if (details.url.indexOf("http://jira.51zxtx.com/rest/issueNav/1/issueTable") !== -1 ||
                    details.url.indexOf("http://jira.51zxtx.com/issues/") !== -1) {
                    chrome.storage.sync.get('enable_workload_sum', function (data) {
                        if (data && data.enable_workload_sum === 'Yes') {
                            BACK_GROUND.send_msg_to_content_script({cmd: 'show_workload_sum'}, function (response) {
                            });
                        }
                    });
                }
            }, {urls: ["http://jira.51zxtx.com/*"]}, []);
        }
    };
})();
BACK_GROUND.init();
