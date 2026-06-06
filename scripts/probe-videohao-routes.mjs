const urls = [
  "https://res.wx.qq.com/t/wx_fed/finder/helper/content/finder-helper-content/res/static/js/async/72.6984aca3.js",
  "https://res.wx.qq.com/t/wx_fed/finder/helper/content/finder-helper-content/res/static/js/async/121.c8ca2921.js",
  "https://res.wx.qq.com/t/wx_fed/finder/helper/content/finder-helper-content/res/static/js/async/691.b58c02c0.js",
  "https://res.wx.qq.com/t/wx_fed/finder/helper/content/finder-helper-content/res/static/js/async/755.af426d0f.js",
];

const routePattern =
  /routeName:"[^"]+"|path:"[^"]+"|name:"Post[^"]+"|Post[A-Za-z0-9_]{3,48}|Finder[A-Za-z0-9_]{3,56}|finderNewLife[A-Za-z0-9_]{0,48}/g;

for (const url of urls) {
  const text = await (await fetch(url)).text();
  const found = [...new Set(text.match(routePattern) || [])]
    .filter((item) => /Post|Finder|finder|NewLife|Life/i.test(item))
    .slice(0, 240);
  console.log(`\nURL ${url.split("/").pop()}`);
  console.log(found.join("\n"));
}
