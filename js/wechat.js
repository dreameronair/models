/* 微信内置浏览器适配: 音频解锁时机、分享信息、返回键处理 */
(function (global) {
  'use strict';

  var MK = global.MK;
  var ua = global.navigator.userAgent || '';

  var Wechat = {
    isWechat: /micromessenger/i.test(ua),
    isIOS: /iphone|ipad|ipod/i.test(ua),
    isAndroid: /android/i.test(ua)
  };

  /** 微信里 WebAudio 需要等 JSBridge 就绪或用户手势, 两条路都挂上。 */
  Wechat.onBridgeReady = function (callback) {
    if (typeof global.WeixinJSBridge !== 'undefined') {
      callback();
      return;
    }
    global.document.addEventListener('WeixinJSBridgeReady', callback, false);
  };

  /**
   * 配置微信分享卡片。需要后端提供 JSSDK 签名, 在页面里提前注入:
   *   window.WX_JSSDK_CONFIG = { appId, timestamp, nonceStr, signature };
   * 未注入时静默跳过, 玩家仍可用右上角菜单手动分享(标题与 og 标签已就绪)。
   */
  Wechat.setupShare = function (info) {
    var config = global.WX_JSSDK_CONFIG;
    if (!config || typeof global.wx === 'undefined') return false;

    var wx = global.wx;
    try {
      wx.config({
        debug: false,
        appId: config.appId,
        timestamp: config.timestamp,
        nonceStr: config.nonceStr,
        signature: config.signature,
        jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData']
      });
      wx.ready(function () {
        var payload = {
          title: info.title,
          desc: info.desc,
          link: info.link,
          imgUrl: info.imgUrl
        };
        if (wx.updateAppMessageShareData) wx.updateAppMessageShareData(payload);
        if (wx.updateTimelineShareData) {
          wx.updateTimelineShareData({ title: info.title, link: info.link, imgUrl: info.imgUrl });
        }
      });
      return true;
    } catch (e) {
      return false;
    }
  };

  Wechat.shareInfo = function (extraTitle) {
    var base = global.location.href.split('#')[0];
    return {
      title: extraTitle || '奇妙萌可消消乐',
      desc: '六只魔法萌宠三消闯关，快来挑战三星通关！',
      link: base,
      imgUrl: base.replace(/[^/]*$/, '') + 'assets/ui/share.png'
    };
  };

  MK.Wechat = Wechat;
})(window);
