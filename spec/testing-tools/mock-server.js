/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and limitations
 * under the License.
*********************************************************************************/
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var debug = require('debug');

var debugFind = debug('mock-server:find');
var debugCreate = debug('mock-server:create');
var debugUpdate = debug('mock-server:update');
var debugDelete = debug('mock-server:delete');

var BASE = path.join(process.cwd(), 'spec/testing-tools/mocks');
function fileForUrl(url, collections) {
  var extension;

  if (url.indexOf('?') !== -1) {
    url = url.slice(0, url.indexOf('?'));
  }
  url = url.slice('/api/'.length);
  extension = url.charAt(url.length - 1) === '/' ? '' : '.json';
  if (collections && url.charAt(url.length - 1) === '/') {
    extension = 'all.json';
  }

  return path.join(BASE, url + extension);
}

function respondWith(response, status, body) {
  response.writeHead(status, {
    'Content-Length': body.length,
    'Content-Type': 'application/vnd.api+json'
  });
  response.end(body);
}

function findObject(request, response) {
  var filePath; var text; var status;

  if (request.url === '/api/cat' ||
      request.url === '/api/person/1/pets' ||
      request.url === '/api/person/1/pets/1/flees') {
    request.url += '/';
  }

  filePath = fileForUrl(request.url, true);
  debugFind('filePath', filePath);
  try {
    text = fs.readFileSync(filePath, {encoding: 'utf8'});
  } catch (e) {
    text = '';
  }

  status = text.length !== 0 ? 200 : 404;
  respondWith(response, status, text);
}

function createObject(request, response) {
  var filePath; var data = '';

  if (request.url === '/api/person' ||
      request.url === '/api/person/1/pets') {
    request.url += '/';
  }

  filePath = fileForUrl(request.url, false);
  debugCreate('filePath', filePath);
  try {
    var stat = fs.statSync(filePath);
    if (!stat.isDirectory()) {
      respondWith(response, 403, JSON.stringify({error: 'Invalid request'}));
    }
  } catch (e) {
    respondWith(response, 403, JSON.stringify({error: 'Invalid request'}));
    return;
  }

  request.on('data', function(chunk) {
    data += chunk;
  });

  request.on('end', function() {
    var json = JSON.parse(data);
    var resp = JSON.parse(data);
    var oldId = json.data.id;
    var status = 200;
    debugCreate('received:', data);

    resp.data.id = 1;
    resp.data.meta = resp.data.meta || {};
    resp.data.meta.clientId = oldId;

    if (resp.data.attributes.name === 'FAIL') {
      status = 403;
      resp = {error: 'Invalid request'};
    }

    debugCreate('responding with:', resp);
    respondWith(response, status, JSON.stringify(resp));
  });
}

function updateObject(request, response) {
  var filePath; var data = '';

  filePath = fileForUrl(request.url, false);
  try {
    fs.statSync(filePath);
  } catch (e) {
    respondWith(response, 403, JSON.stringify({error: 'Invalid request'}));
    return;
  }

  request.on('data', function(chunk) {
    data += chunk;
  });

  request.on('end', function() {
    var json = JSON.parse(data);
    var status = 200;
    debugUpdate('received:', json);

    // remove empty relationship keys
    Object.keys(json.data.relationships).forEach(function(rel) {
      if (json.data.relationships[rel].data === null) {
        delete json.data.relationships[rel];
      } else if (json.data.relationships[rel].data instanceof Array &&
                json.data.relationships[rel].data.length === 0) {
        delete json.data.relationships[rel];
      }
    });

    debugUpdate('responding with:', json);
    respondWith(response, status, JSON.stringify(json));
  });
}

function patchExtension(request, response) {
  var data = '';

  request.on('data', function(chunk) {
    data += chunk;
  });

  request.on('end', function() {
    var patches = JSON.parse(data);
    debugUpdate('patches:', patches);
    if (patches.length === 1) {
      var path = fileForUrl('/api/person/1');
      respondWith(response, 200, '[' +
                                  fs.readFileSync(path, {encoding: 'utf8'}) +
                                  ']');
    } else {
      respondWith(response, 204, '');
    }
  });
}

function deleteObject(request, response) {
  var filePath;

  filePath = fileForUrl(request.url, false);
  try {
    fs.statSync(filePath);
  } catch (e) {
    debugDelete('file for url', request.url, 'does not exist');
    respondWith(response, 403, JSON.stringify({error: 'Invalid request'}));
    return;
  }

  respondWith(response, 204, '');
}

module.exports = http.createServer(function(request, response) {
  if (!request.headers['content-type'] ||
      !request.headers['content-type'].search('application/vnd.api+json')) {
    respondWith(response, 415, '{"error": "Invalid Content-Type"}');
    return;
  }

  switch (request.method) {
    case 'GET':
      debugFind('GETing data from:', request.url);
      findObject(request, response);
      break;

    case 'POST':
      debugCreate('POSTing data to:', request.url);
      createObject(request, response);
      break;

    case 'PATCH':
      debugUpdate('PATCHing data to:', request.url);
      if (request.headers['content-type'] ===
                          'application/vnd.api+json; ext=jsonpatch') {
        patchExtension(request, response);
      } else {
        updateObject(request, response);
      }
      break;

    case 'DELETE':
      debugDelete('DELETEing data to:', request.url);
      deleteObject(request, response);
      break;

    default:
      respondWith(response, 500, '{"error": "Unknown method `' +
                                  request.method + '`"}');
      break;
  }

});
