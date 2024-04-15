(function ($) {
  $.fn.countdown = function(options, callback) {

    // ...

    var countdown = function() {

      // ...

      if (distance < 0) {
        clearInterval(interval);
        if (callback && typeof callback === 'function') callback();
      }
    };

    // ...

  };
})(jQuery);

$(function() {
  $('.countdown').each(function() {
    var $this = $(this);
    $this.countdown({ date: $this.data('countdown') }, function() {
      $('<div class="countdown-label">已到期</div>').appendTo($this);
    });
  });
});
