// proxy-server.js
var express = require('express');
var url = require('url');
var proxy = require('proxy-middleware');

var app = express();

app.use('/', express.static('build/web/'));
app.use('/', proxy(url.parse('http://localhost:4080/')));

var server = app.listen(8882, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Proxy server running on http://%s:%s/', host, port);
});
