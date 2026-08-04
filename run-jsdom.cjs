const { JSDOM } = require("jsdom");
JSDOM.fromURL("http://localhost:3000/", { 
  runScripts: "dangerously", 
  resources: "usable"
}).then(dom => {
  dom.window.onerror = (msg, src, line, col, err) => {
    console.log("JSDOM Error:", msg);
  };
  dom.window.addEventListener("unhandledrejection", (e) => {
    console.log("JSDOM Unhandled Rejection:", e.reason);
  });
  setTimeout(() => {
    console.log("JSDOM test complete. HTML:");
    console.log(dom.window.document.body.innerHTML.substring(0, 200));
  }, 5000);
});
