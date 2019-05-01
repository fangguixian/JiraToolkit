var OPTIONS = (function () {
    return {
        // 初始化
        init: function () {
            OPTIONS.init_data();
            $('#apply').on('click', OPTIONS.apply);
            $('#save_and_close').on('click', OPTIONS.save_and_close);
        },
        // 初始化数据
        init_data: function () {
            // 开启合计
            chrome.storage.sync.get(['enable_workload_sum'], function (data) {
                if (data && data.enable_workload_sum === 'Yes') {
                    $('#enable_workload_sum_yes').click();
                } else {
                    $('#enable_workload_sum_no').click();
                }
            });
        },
        // 应用
        apply: function () {
            // 开启合计
            var enable_workload_sum = $('[name=enable_workload_sum]:checked').val();
            if (enable_workload_sum) chrome.storage.sync.set({enable_workload_sum: enable_workload_sum});

            $('.message').removeClass('error').addClass('success').text('保存成功');
            setTimeout(function () {
                $('.message').removeClass('success').text('');
            }, 2000);
        },
        // 保存并关闭
        save_and_close: function () {
            OPTIONS.apply();
            window.close();
        }
    };
})();
OPTIONS.init();
