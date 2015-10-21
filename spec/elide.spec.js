/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
/* jshint expr: true */
'use strict';

var chai = require('chai');
var expect = chai.expect;

var ES6Promise = require('es6-promise').Promise;
var ELIDE = require('../lib/elide');
var Elide = ELIDE.default;
var Query = require('../lib/query');

describe('Elide', function() {
  var schema = {
    stores: {
      store1: {
        type: 'memory',
        ttl: 60000
      }
    },
    models: {
      model1: {
        meta: {
          store: 'store1',
          isRootObject: true
        },
        name: 'string'
      }
    }
  };

  var options = {
    promise: ES6Promise
  };

  it('should NOT throw any errors when configured correctly', function() {
    expect(function() {
      new Elide(schema, options);
    }).not.to.throw();
  });

  describe('configuration', function() {
    it('should throw an error with no configuration', function() {
      expect(function() {
        new Elide(schema);
      }).to.throw(ELIDE.ERROR_INVALID_OPTIONS);
    });

    it('should throw an error without a promise option', function() {
      expect(function() {
        new Elide(schema, {
          dummyOption: 'dummyOption'
        });
      }).to.throw(ELIDE.ERROR_INVALID_PROMISE);
    });

    it('should throw an error without a null promise option', function() {
      expect(function() {
        new Elide(schema, {
          promise: null
        });
      }).to.throw(ELIDE.ERROR_INVALID_PROMISE);
    });
  });

  describe('methods', function() {
    var elide;
    beforeEach(function() {
      elide = new Elide(schema, options);
    });

    it('should have #find', function() {
      expect(elide.find).to.be.a('function');
      expect(elide.find('model1', 1)).to.be.an.instanceof(Query);
    });

    it('should have #create', function(done) {
      expect(elide.create).to.be.a('function');
      elide.create('model1', {name: 'foo'}).then(function(model) {
        expect(model).to.have.a.property('name', 'foo');
        expect(model).to.have.a.property('id');
        done();
      }, done);
    });

    it('should have #update', function(done) {
      expect(elide.update).to.be.a('function');
      var model1 = {name: 'foo'};
      elide.create('model1', model1).then(function(model) {
        model1 = model;
        return elide.update('model1', {id: model1.id, name: 'bar'});

      }).then(function(model) {
        expect(model).to.have.a.property('name', 'bar');
        expect(model).to.have.a.property('id', model1.id);

        done();
      }).catch(done);
    });

    it('should have #delete', function(done) {
      expect(elide.delete).to.be.a('function');

      var model1 = {name: 'foo'};
      elide.create('model1', model1).then(function(model) {
        model1 = model;
        return elide.delete('model1', {id: model1.id});

      }).then(done).catch(done);
    });

    it('should have #commit', function() {
      expect(elide.commit).to.be.a('function');
    });
  });

  describe('models', function() {
    var stores = {
      store1: {
        type: 'memory'
      }
    };
    var options = {
      promise: ES6Promise
    };

    it('should require the schema to have a models section', function() {
      expect(function() {
        new Elide({
          stores: stores
        }, options);
      }).to.throw(ELIDE.ERROR_INVALID_MODELS);
    });

    it('should require the models section to not be empty', function() {
      expect(function() {
        new Elide({
          stores: stores,
          models: {}
        }, options);
      }).to.throw(ELIDE.ERROR_NUM_MODELS);
    });

    describe('meta', function() {
      it('should require all models have a store', function() {
        // has store
        expect(function() {
          new Elide({
            stores: stores,
            models: {
              model1: {}
            }
          }, options);
        }).to.throw(ELIDE.ERROR_BAD_STORE.replace('${modelName}', 'model1'));

        // has invalid store
        expect(function() {
          new Elide({
            stores: stores,
            models: {
              model1: {
                meta: {
                  store: 'store2'
                }
              }
            }
          }, options);
        }).to.throw(ELIDE.ERROR_BAD_STORE.replace('${modelName}', 'model1'));
      });
    });

    describe('relationships', function() {
      var meta = {
        store: 'store1',
        isRootObject: true
      };
      var model2 = {
        meta: meta
      };

      it('should require all links to specify a valid type', function() {
        var schema = {
          stores: stores,
          models: {
            model1: {
              meta: meta,
              links: {
                link1: {
                  model: 'model2'
                }
              }
            },
            model2: model2
          }
        };

        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_NO_LINK_TYPE.replace('${modelName}', 'model1'));

        schema.models.model1.links.link1.type = 'oneToOne';
        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_BAD_LINK_TYPE.replace('${linkType}', 'oneToOne'));
      });

      it('should require all links to specify a valid model', function() {
        var schema = {
          stores: stores,
          models: {
            model1: {
              meta: meta,
              links: {
                link1: {
                  type: 'hasOne'
                }
              }
            },
            model2: model2
          }
        };

        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_NO_LINK_MODEL.replace('${modelName}', 'model1'));

        schema.models.model1.links.link1.model = 'model3';
        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_BAD_LINK_MODEL.replace('${modelName}', 'model1'));

        schema.models.model1.links.link1.model = 'model2';
        expect(function() {
          new Elide(schema, options);
        }).not.to.throw();
      });

      it('should require no link overwrites a property on the model');

      it('should require all models be rootable', function() {
        var schema = {
          stores: stores,
          models: {
            model1: {
              meta: {
                store: 'store1',
                isRootObject: true
              },
              links: {
                child: {
                  model: 'model2',
                  type: 'hasOne'
                }
              }
            },
            model2: {
              meta: {
                store: 'store1'
              }
            }
          }
        };

        expect(function() {
          new Elide(schema, options);
        }).not.to.throw();

        schema.models.model1.meta.isRootObject = false;
        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_DANGLING_MODEL.replace('${modelName}', 'model1'));

        schema.models.model1.meta.isRootObject = true;
        schema.models.model3 = {
          meta: {
            store: 'store1'
          }
        };
        expect(function() {
          new Elide(schema, options);
        }).to.throw(ELIDE.ERROR_DANGLING_MODEL.replace('${modelName}', 'model3'));
      });
    });

  });

  describe('stores', function() {
    var minModels = {
      model1: {
        meta: {
          store: 'store1',
          isRootObject: true
        },
        links: {}
      }
    };
    var schema = {
      stores: {
        store1: {
          type: 'memory',
          upstream: 'store2',
          ttl: 60000
        },
        store2: {
          type: 'jsonapi',
          upstream: undefined,
          baseURL: 'http://foo.bar.com'
        }
      },
      models: minModels
    };

    var options = {
      promise: ES6Promise
    };

    it('should require schema to have a stores section', function() {
      expect(function() {
        new Elide({}, options);
      }).to.throw(Elide.ERROR_NUM_STORES);

      ['stores', [], 2, null, undefined].map(function(invalidStores) {
        expect(function() {
          new Elide({
            stores: invalidStores
          }, options);
        }).to.throw(Elide.ERROR_INVALID_STORES);
      });
    });

    it('should require stores section not to be empty', function() {
      expect(function() {
        new Elide({
          stores: {},
          models: minModels
        }, options);
      }).to.throw(ELIDE.ERROR_NUM_STORES);
    });

    it('should reject stores of invalid type', function() {
      expect(function() {
        new Elide({
          stores: {
            store1: {
              type: 'foo',
              ttl: 99,
              baseURL: 'ssh://foo@stuf.bar'
            }
          },
          models: minModels
        }, options);
        // jscs:disable maximumLineLength
      }).to.throw(ELIDE.ERROR_BAD_STORE_TYPE.replace('${storeType}', 'foo'));
      // jscs:enable maximumLineLength
    });

    it('should reject stores with invalid upstream store', function() {
      expect(function() {
        new Elide({
          stores: {
            store1: {
              type: 'memory',
              upstream: 'store2'
            },
          },
          models: minModels
        }, options);
        // jscs:disable maximumLineLength
      }).to.throw(ELIDE.ERROR_UNKNOWN_UPSTREAM_STORE.replace(/\$\{storeName\}/g, 'store2'));
      // jscs:enable maximumLineLength
    });

    it('should set ttl correctly', function() {
      var elide = new Elide(schema, options);

      expect(elide._stores.store1._ttl).to.be.equal(60000);
      expect(elide._stores.store2._ttl).to.be.undefined;
    });

    it('should set baseURL correctly', function() {
      var elide = new Elide(schema, options);

      expect(elide._stores.store1._baseURL).to.be.undefined;
      expect(elide._stores.store2._baseURL).to.be.equal('http://foo.bar.com');
    });

    it('should set upstream stores correctly', function() {
      var elide = new Elide(schema, options);
      expect(elide._stores.store1._upstream).to.equal(elide._stores.store2);
    });

    it.skip('should set models correctly', function() {
      var elide = new Elide(schema, options);
      expect(elide._stores.store1._models).to.deep.equal(elide._models);
    });
  });

});
