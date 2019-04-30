var BACK_GROUND = (function () {
    return {
        // 初始化
        init: function () {
            BACK_GROUND.add_rule();
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
        }
    };
})();
BACK_GROUND.init();
