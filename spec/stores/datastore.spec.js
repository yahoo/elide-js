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
/* jshint expr: true */
// jscs:disable maximumLineLength
'use strict';

var chai = require('chai');
chai.use(require('chai-as-promised'));
var expect = chai.expect;
var DATASTORE  = require('../../lib/datastores/datastore');
var Datastore  = DATASTORE.default;
var inherits   = require('inherits');
var ES6Promise = require('es6-promise').Promise;
var Query      = require('../../lib/query');

var FooStore = function FooStore(Promise, ttl, baseURL, models) {
  FooStore.super_.call(this, Promise, ttl, baseURL, models);
};
inherits(FooStore, Datastore);
['find', 'create', 'update', 'delete', 'commit'].forEach(function(method) {
  FooStore.prototype['_' + method] = function(model, state) {
    return new this._promise(function(resolve, reject) {});
  };
});

describe('Datastore', function() {

  describe('initialization', function() {
    it('should require a promise library', function() {
      expect(function() {
        new Datastore();
      }).to.throw(DATASTORE.ERROR_NO_PROMISE);

      expect(function() {
        new Datastore('will fail');
      }).to.throw(DATASTORE.ERROR_NO_PROMISE);
    });

    it('should require models', function() {
      expect(function() {
        new Datastore(ES6Promise);
      }).to.throw(DATASTORE.ERROR_NO_MODELS);
    });

    it('should use the specified promise library', function() {
      var ds = new Datastore(ES6Promise, undefined, undefined, {});

      expect(ds._promise).to.be.equal(ES6Promise);
    });

    it('should set ttl correctly', function() {
      var ds = new Datastore(ES6Promise, 1000, undefined, {});

      expect(ds._ttl).to.equal(1000);
    });

    it('should reject invalid ttls', function() {
      ['', {}, [], null].map(function(badTTL) {
        expect(function() {
          new Datastore(ES6Promise, badTTL);
        }).to.throw(Datastore.ERROR_BAD_TTL);
      });

      expect(function() {
        new Datastore(ES6Promise, -40, undefined, {});
      }).to.throw(Datastore.ERROR_NEG_TTL);
    });

    it('should set baseURL correctly', function() {
      var ds = new Datastore(ES6Promise, undefined, 'http://foo.bar.com', {});

      expect(ds._baseURL).to.equal('http://foo.bar.com');
    });

    it('should reject invalid baseURLs', function() {
      [/foo/, {}, [], null].map(function(badURL) {
        expect(function() {
          new Datastore(ES6Promise, undefined, badURL);
        }).to.throw(Datastore.ERROR_BAD_BASEURL);
      });
    });

    it('should set models correctly', function() {
      var models = {};
      var ds = new Datastore(ES6Promise, undefined, undefined, models);
      expect(ds._models).to.equal(models);
    });
  });

  ['create', 'update', 'delete'].map(function(method) {
    describe('#' + method, function() {
      it('should return a promise', function() {
        var foo = new FooStore(ES6Promise, undefined, undefined, {});
        var promise = foo[method]('model', {});
        expect(promise).to.be.an.instanceof(ES6Promise);
      });

      it('should throw an error if no ' + method + ' function exists', function() {
        var store = new Datastore(ES6Promise, undefined, undefined, {});
        expect(store[method]('model', {})).to.eventually.be.rejectedWith('Not implemented');
      });
    });

  });

  describe('#find', function() {
    it('should return a promise', function() {
      var foo = new FooStore(ES6Promise, undefined, undefined, {});
      var q = new Query(foo, 'model', 1);
      var promise = foo.find(q);
      expect(promise).to.be.an.instanceof(ES6Promise);
    });

    it('should require a Query', function() {
      var foo = new FooStore(ES6Promise, undefined, undefined, {});
      var q = new Query(foo, 'model', 1);
      expect(function() {
        foo.find(q);
      }).not.to.throw();

      expect(function() {
        foo.find('model1', 1);
      }).to.throw(DATASTORE.ERROR_MUST_FIND_QUERY);
    });

    it('should throw an error if no find function exists', function() {
      var ds = new Datastore(ES6Promise, undefined, undefined, {});
      var q = new Query(ds, 'model', 1);
      expect(ds.find(q)).to.eventually.be.rejectedWith('Not implemented');
    });
  });

  describe('#commit', function() {
    it('should return a promise', function() {
      var foo = new FooStore(ES6Promise, undefined, undefined, {});
      var promise = foo.commit();
      expect(promise).to.be.an.instanceof(ES6Promise);
    });

    it('should throw an error if no _commit function exists', function() {
      var ds = new Datastore(ES6Promise, undefined, undefined, {});
      expect(ds.commit()).to.eventually.be.rejectedWith('Not implemented');
    });
  });

  describe('#setUpstream', function() {
    it('should let you put a datastore upstream', function() {
      var store1 = new Datastore(ES6Promise, undefined, undefined, {});
      var store2 = new Datastore(ES6Promise, undefined, undefined, {});
      store1.setUpstream(store2);

      expect(store1._upstream).to.be.equal(store2);
    });
    it('should ONLY let you put a datastore upstream', function() {
      var store = new Datastore(ES6Promise, undefined, undefined, {});
      expect(function() { store.setUpstream('wont work'); }).to.throw();
    });
  });
});
