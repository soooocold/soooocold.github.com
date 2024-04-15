hexo.extend.filter.register('after_post_render', function(data) {
  if (data.layout === 'post' && data.countdown) {
    data.content += '<script type="text/javascript" src="/js/jquery.countdown.min.js"></script>';
    data.content += '<script type="text/javascript" src="/js/countdown.js"></script>';
  }
});
