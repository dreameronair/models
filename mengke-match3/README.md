# 奇妙萌可消消乐

一个面向微信内置浏览器的三消（match-3）小游戏，纯静态实现，把整个目录丢到任意能跑 HTTPS 的静态托管上就能玩，没有构建步骤、没有后端依赖。

游戏里有六只魔法萌宠、四种魔法棋子、10 个带收集目标的关卡，以及三星评分与本地进度存档。

## 关于角色形象的版权

**奇妙萌可（Wonder Moke）是有版权的商业动画 IP，本仓库不包含任何官方美术资源。**

`assets/characters/` 下的六个形象是按同类"魔法萌宠"风格生成的**原创角色**（蜜莉 / 露娜 / 布丁 / 青青 / 星梦 / 火火），可以自由使用。

如果你已经拿到官方授权素材，替换非常简单：把授权图按下面的文件名放进 `assets/characters/` 覆盖即可，代码不用改。

| 文件名 | 游戏内角色 | 主色 |
| --- | --- | --- |
| `rabbit.png` | 蜜莉（兔） | 粉 |
| `cat.png` | 露娜（猫） | 蓝 |
| `bear.png` | 布丁（熊） | 黄 |
| `dragon.png` | 青青（龙） | 绿 |
| `unicorn.png` | 星梦（独角兽） | 紫 |
| `fox.png` | 火火（狐） | 橙 |

素材要求：正方形、透明背景 PNG，建议 256×256，角色居中并留一点边距。名字与配色想改的话在 `js/core.js` 的 `CHARACTERS` 里调整。

如果某张图加载失败，游戏不会白屏——`js/assets.js` 会用 Canvas 现画一个简笔萌宠头像兜底，并在加载页提示"部分素材缺失"。

## 本地运行

必须用 HTTP 服务打开，不能直接双击 `index.html`（Canvas 读图会被浏览器的 file:// 跨域策略拦住）。

```bash
cd mengke-match3
python3 -m http.server 8123
# 然后浏览器打开 http://127.0.0.1:8123/
```

调手机效果时，用 Chrome DevTools 的设备模拟（iPhone SE 320×568 到 iPhone 14 Pro Max 都验证过），或者让手机连同一个局域网访问电脑 IP。

## 部署到微信 H5

1. **必须 HTTPS。** 微信从 iOS 端开始就会拦截混合内容，http 页面里的图片可能直接不显示。
2. 上传整个 `mengke-match3/` 目录到静态托管（对象存储 + CDN、Nginx、GitHub Pages、Vercel 等都行），保持目录结构不变。
3. **如果放在子路径下**（比如 `https://example.com/games/mengke/`），不用改任何代码——所有资源引用都是相对路径。
4. **想让分享卡片显示自定义标题和缩略图**，需要公众号的 JSSDK 签名。在 `index.html` 里引入 JSSDK 并注入签名后，`js/wechat.js` 会自动接管：

   ```html
   <script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
   <script>
     // 签名必须由后端用 appId + appSecret 生成，不要写在前端
     window.WX_JSSDK_CONFIG = {
       appId: 'wx...',
       timestamp: 1700000000,
       nonceStr: 'xxx',
       signature: '...'
     };
   </script>
   ```

   记得把域名加到公众号后台的「JS 接口安全域名」。**没配签名也能玩**，玩家仍然可以用右上角「···」菜单手动分享，标题和 `og:` 缩略图已经在 `index.html` 里配好了。
5. 更新版本后如果玩家看到旧页面，是 CDN 或微信的缓存。给 JS/CSS 加个查询串（`style.css?v=2`）或者配好 `Cache-Control` 即可。

已经处理过的微信踩坑点：

- **音频不响**：微信和 iOS 都不允许自动播声音。`js/main.js` 里在第一次 `touchend` 和 `WeixinJSBridgeReady` 两个时机解锁 WebAudio。
- **页面被拖动 / 橡皮筋回弹**：全局拦掉 `touchmove`，但放行关卡列表和弹层内部的滚动。
- **双击缩放、长按弹菜单**：viewport 锁死 + 拦掉 `gesturestart` 和 `contextmenu`。
- **刘海屏与底部小黑条**：布局用 `env(safe-area-inset-*)` 留白。
- **X5 内核强制竖屏**：加了 `x5-orientation` 等一组 meta；真横屏时盖一层"请竖屏使用"。
- **兼容性**：所有前端代码只用 `var` + `Promise`，不含箭头函数、模板字符串、可选链、`class`，微信的旧 X5 内核也能跑。

## 玩法

- 滑动或点选两只相邻萌宠交换位置，横或竖连成 3 只以上即可消除。
- 消除后上方萌宠掉落，可能触发连锁，每层连锁分数倍率 +0.5。
- 在限定步数内完成 HUD 上的收集目标即通关；得分决定 1～3 星（目标分的 0.6 / 1.0 / 1.5 倍）。
- 没有可消除组合时自动洗牌；空闲 4.5 秒会自动高亮一个可行走法。

四种魔法棋子（消除时自动生成，会带金色光环）：

| 棋子 | 生成条件 | 效果 |
| --- | --- | --- |
| 横向闪电 | 横向 4 连 | 消除整行 |
| 纵向闪电 | 纵向 4 连 | 消除整列 |
| 魔法炸弹 | L 形或 T 形 | 炸掉周围九格 |
| 彩虹魔杖 | 5 连 | 清除某一种萌宠的全部棋子 |

两个魔法棋子互相交换会触发合体技：双彩虹清空全盘，炸弹配闪电清掉三行三列。

道具：魔法锤（敲掉任意一只，不消耗步数）、重新洗牌、找一找。

## 目录结构

```
mengke-match3/
├── index.html              页面骨架与微信相关 meta
├── css/style.css           全部样式（竖屏、安全区、小屏适配）
├── js/
│   ├── core.js             配置、角色表、关卡表、补间动画引擎
│   ├── board.js            棋盘与消除规则（纯逻辑，可在 Node 里跑）
│   ├── game.js             Canvas 渲染、触控输入、消除流程编排
│   ├── assets.js           图片加载与缺图兜底
│   ├── audio.js            WebAudio 实时合成音效与 BGM
│   ├── ui.js               页面切换、HUD、弹层
│   ├── wechat.js           微信适配与分享
│   └── main.js             启动入口与事件绑定
├── assets/
│   ├── characters/*.png    六个角色精灵（可替换）
│   └── ui/                 背景图与分享缩略图
└── tools/
    ├── make_assets.py      角色立绘抠图 → 游戏精灵
    ├── test_board.js       消除逻辑无头测试
    └── test_browser.js     Playwright 端到端测试
```

音效和背景音乐是 WebAudio 实时合成的，没有任何音频文件，所以首屏只需要下载 7 张图。

## 改关卡

`js/core.js` 的 `LEVELS` 是一个数组，加一项就多一关，界面和解锁逻辑会自动跟上：

```js
{
  types: 6,          // 本关出现几种萌宠（越少越容易凑对）
  moves: 20,         // 步数上限
  target: 4200,      // 二星线，三星是它的 1.5 倍，一星是 0.6 倍
  collect: [         // 收集目标，type 是 CHARACTERS 的下标
    { type: 0, count: 16 },
    { type: 1, count: 16 }
  ]
}
```

难度手感相关的参数（棋盘大小、分数、动画时长、道具数量、提示延迟）都在同一个文件的 `CONFIG` 里。

## 测试

```bash
npm test           # 消除逻辑，43 项，纯 Node 无需浏览器
npm run test:browser   # 端到端，65 项，需要先 npm i && npx playwright install chromium
```

`tools/test_board.js` 覆盖三连识别、四种特殊棋子的生成条件与引爆范围、连锁引爆、重力补充、走法判定、洗牌，以及 30 局 × 60 步的对局模拟（检查棋盘始终填满、不残留三连、消除流程一定收敛）。

`tools/test_browser.js` 用移动端视口 + 微信 UA 真实驱动 DOM：点选和滑动两种操作、无效交换回弹不扣步数、四种魔法棋子在确定性棋盘上的生成位置、合体技、道具、暂停、通关与失败结算、关卡解锁、小屏布局，并断言全程没有 console 报错和资源加载失败。跑完会把截图输出到 `.shots/`。

## 重新生成角色素材

`tools/make_assets.py` 把纯色背景的角色立绘处理成透明精灵：采样四角背景色 → 从边缘泛洪出背景连通域（不会挖掉角色身上的同色部分）→ 羽化边缘 → 按不透明像素裁切 → 补成正方形 → 缩放到 256×256。

```bash
pip install Pillow numpy scipy
python3 tools/make_assets.py <原始立绘目录>
```

原始图需要是品红等纯色背景、角色带白色描边的贴纸风格。如果你的素材本来就是透明 PNG，跳过这一步直接放进 `assets/characters/` 就行。
