import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(".");
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".lrc":"text/plain; charset=utf-8", ".srt":"text/plain; charset=utf-8", ".vtt":"text/vtt; charset=utf-8" };
http.createServer((req,res)=>{
  const file = path.resolve(root, decodeURIComponent((req.url || "/").split("?")[0].slice(1)) || "index.html");
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file,(error,data)=>{ if(error){res.writeHead(404);res.end("not found");return;} res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream"});res.end(data); });
}).listen(8765,"127.0.0.1");
