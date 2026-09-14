/*
 * 形象皮肤配置。
 *
 * original: 仓库自带的原创魔法萌宠, 离线可用。
 * official: 奇妙萌可(原作《Catch! Teenieping》)的官方角色, 在线加载。
 *           图片托管在 Catch! Teenieping Wiki (Fandom) 的 CDN 上, 返回
 *           Access-Control-Allow-Origin: *, 所以能外链也能被游戏缓存下来。
 *
 *           地址必须用不带 /revision/... 的裸形式: 带 /revision/ 的那种
 *           在请求头有 Referer 时会被防盗链挡成 404, 而 404 响应本身是一张
 *           占位图, 浏览器会当成加载成功, 于是棋盘上画出一堆灰色破图图标。
 *           裸地址不受影响, 且 CDN 会按 Accept 自动转 WebP, 每张只 8~15KB。
 *
 * 想换成别的图: 把下面 images 里对应的地址替换掉即可, 键名不要改。
 * 任何一张加载失败或超时, 游戏会自动用 original 的同名形象顶上, 不会白屏。
 */
(function (global) {
  'use strict';

  var WIKI = 'https://static.wikia.nocookie.net/catchteeniepin/images/';

  global.MK.SKINS = {
    original: {
      id: 'original',
      label: '原创萌宠',
      source: 'local'
    },
    official: {
      id: 'official',
      label: '官方萌可',
      source: 'remote',
      credit: '角色图片来自 Catch! Teenieping Wiki (Fandom)',
      // 都挑了脸大、无相框、背景透明的那种, 缩到棋盘格子里才认得出谁是谁
      images: {
        // 爱心萌可 Heartsping (粉)
        rabbit: WIKI + 'e/ea/Heartsping_S1_2D_Icon_2.png',
        // 正正萌可 Dadaping (蓝, 眼镜与书)
        cat: WIKI + '5/51/Dadaping_Render_1.png',
        // 勇气萌可 Gogoping (黄, 相机)
        bear: WIKI + 'e/e7/Gogoping_Render_13.png',
        // 盼盼萌可 Chachaping (绿, 四叶草)
        dragon: WIKI + '0/0c/Chachaping_2D_Icon.png',
        // 唱唱萌可 Lalaping (紫, 音符)
        unicorn: WIKI + '1/17/Lalaping_2D_Icon.png',
        // 娜娜萌可 Nanaping (红)
        fox: WIKI + 'd/dc/Nanaping_Icon.png'
      }
    }
  };
})(window);
