/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

import Query from './query';
import MemoryDatastore from './datastores/memorydatastore';
import JsonApiDatastore from './datastores/jsonapidatastore';

import clone from './helpers/clone';
import { objectLooksLikePromise } from './helpers/checkpromise';

// jscs:disable maximumLineLength
export let ERROR_INVALID_SCHEMA = 'Invalid Elide schema format.';
export let ERROR_INVALID_OPTIONS = 'Invalid Elide options specified.';
export let ERROR_INVALID_PROMISE = 'Invalid Promise/A+ library specified.';
export let ERROR_INVALID_STORES = 'Invalid stores section found in schema.';
export let ERROR_NUM_STORES = 'Elide schema.stores must describe at least one store.';
export let ERROR_INVALID_MODELS = 'Invalid models section found in schema.';
export let ERROR_NUM_MODELS = 'Elide schema.models must describe at least one model.';
export let ERROR_BAD_STORE = 'Elide model "${modelName}" must specify a valid store.';
export let ERROR_BAD_STORE_TYPE = 'Unknown store type "${storeType}".';
export let ERROR_NO_LINK_TYPE = 'Elide model "${modelName}" specifies a link without a type.';
export let ERROR_BAD_LINK_TYPE = 'Invalid link type "${linkType}".';
export let ERROR_NO_LINK_MODEL = 'Elide model "${modelName}" specifies a link to an unknown model.';
export let ERROR_UNKNOWN_MODEL = 'Elide model "${modelName}" does not exist.';
export let ERROR_BAD_LINK_MODEL = 'Elide model "${modelName}" specifies a link to an unknown model.';
export let ERROR_DANGLING_MODEL = 'Elide model "${modelName}" cannot be rooted.';
export let ERROR_UNKNOWN_UPSTREAM_STORE = 'Cannot set upstream store to "${storeName}", "${storeName}" not defined.';
// jscs:enable maximumLineLength

class Elide {
  constructor(schema, options) {
    if (typeof schema !== 'object') {
      throw new Error(ERROR_INVALID_SCHEMA);
    }

    if (typeof options !== 'object') {
      throw new Error(ERROR_INVALID_OPTIONS);
    }
    if (!objectLooksLikePromise(options.promise)) {
      throw new Error(ERROR_INVALID_PROMISE);
    }

    if (typeof schema.stores !== 'object') {
      throw new Error(ERROR_INVALID_STORES);
    }
    if (Object.keys(schema.stores).length === 0) {
      throw new Error(ERROR_NUM_STORES);
    }

    if (typeof schema.models !== 'object') {
      throw new Error(ERROR_INVALID_MODELS);
    }
    if (Object.keys(schema.models).length === 0) {
      throw new Error(ERROR_NUM_MODELS);
    }

    this._promise = options.promise;
    this._stores = {};
    this._modelToStoreMap = {};
    this._storesThatCommit = [];
    this._configureModels(schema.models, Object.keys(schema.stores));
    this._configureStores(schema.stores);

    this.auth = {
      addQueryParameter: this._addQueryParameter.bind(this),
      addRequestHeader: this._addRequestHeader.bind(this),
      reset: this._resetAuthData.bind(this)
    };
  }

  _configureModels(models, storeNames) {
    let rootable = {};
    let canRoot = {};

    // verify metadata and links
    Object.keys(models).map((modelName) => {
      let model = models[modelName];

      if (!model.meta || !model.meta.store) {
        throw new Error(ERROR_BAD_STORE
                        .replace('${modelName}', modelName));
      }
      if (storeNames.indexOf(model.meta.store) === -1) {
        throw new Error(ERROR_BAD_STORE
                        .replace('${modelName}', modelName));
      }
      this._modelToStoreMap[modelName] = model.meta.store;

      if (model.meta.isRootObject === true) {
        rootable[modelName] = true;
      }

      // this is the list of models that can be rooted via the current model
      canRoot[modelName] = [];
      model.links = model.links || {};
      Object.keys(model.links).map(function(linkName) {
        let link = model.links[linkName];

        let linkType = link.type;
        if (!linkType) {
          throw new Error(ERROR_NO_LINK_TYPE
                          .replace('${modelName}', modelName));
        }
        if (linkType !== 'hasOne' && linkType !== 'hasMany') {
          throw new Error(ERROR_BAD_LINK_TYPE
                          .replace('${linkType}', linkType));
        }

        let modelType = link.model;
        if (!modelType) {
          throw new Error(ERROR_NO_LINK_MODEL
                          .replace('${modelName}', modelName));
        }
        if (!models[modelType]) {
          throw new Error(ERROR_BAD_LINK_MODEL
                          .replace('${modelName}', modelName));
        }

        canRoot[modelName].push(modelType);
      });
    });

    // verify rootability by recursively checking children
    var rootChildren = function rootChildren(modelName) {
      rootable[modelName] = true;

      let children = canRoot[modelName];
      children.map(function(childName) {
        rootChildren(childName);
      });
    };
    Object.keys(rootable).map(function(rootableModel) {
      rootChildren(rootableModel);
    });

    Object.keys(models).map(function(model) {
      if (rootable[model] !== true) {
        throw new Error(ERROR_DANGLING_MODEL
                        .replace('${modelName}', model));
      }
    });

    this._models = clone(models);
  }

  _configureStores(stores) {
    Object.keys(stores).map((storeName) => {
      let storeDef = stores[storeName];
      let storeType = storeDef.type;

      let promise = this._promise;
      let ttl = storeDef.ttl;
      let baseURL = storeDef.baseURL;
      let models = clone(this._models);
      let store;

      switch (storeType) {
        case 'memory':
          store = new MemoryDatastore(promise, ttl, baseURL, models);
          this._storesThatCommit.push(storeName);
          break;

        case 'jsonapi':
          store = new JsonApiDatastore(promise, ttl, baseURL, models);
          break;

        default:
          throw new Error(ERROR_BAD_STORE_TYPE
            .replace('${storeType}', storeType));
      }

      this._stores[storeName] = store;
    });

    Object.keys(stores).map((storeName) => {
      let upstreamName = stores[storeName].upstream;
      if (!upstreamName) {
        return;
      }

      let store = this._stores[storeName];
      let upstream = this._stores[upstreamName];

      if (upstream === undefined) {
        throw new Error(ERROR_UNKNOWN_UPSTREAM_STORE
          .replace(/\$\{storeName\}/g, upstreamName));
      }

      store.setUpstream(upstream);
    });
  }

  _getStoreForModel(model) {
    if (!this._modelToStoreMap.hasOwnProperty(model)) {
      throw new Error(ERROR_UNKNOWN_MODEL
        .replace('${modelName}', model));
    }
    return this._stores[this._modelToStoreMap[model]];
  }

  /**
   * Add a query parameter to those stores that compare
   *
   * @param  {String}           key   - the name of the qurey parameter
   * @param  {String}           value - the value of the query parameter
   */
  _addQueryParameter(key, value) {
    Object.keys(this._stores).forEach((store) => {
      this._stores[store].addQueryParameter(key, value);
    });
  }

  /**
   * Add a request header to those stores that care
   *
   * @param  {String}          key   - the name of the header
   * @param  {String}          value - the value of the header
   */
  _addRequestHeader(key, value) {
    Object.keys(this._stores).forEach((store) => {
      this._stores[store].addRequestHeader(key, value);
    });
  }

  /**
   * clear auth data from stores that track it
   *
   */
  _resetAuthData() {
    Object.keys(this._stores).forEach((store) => {
      store.clearAuthData();
    });
  }

  /*
   * PUBLIC INTERFACE
   */

  find(model, id, opts) {
    if (id instanceof Object) {
      opts = id
      id = undefined
    }

    opts = opts || {};
    let store = this._getStoreForModel(model);
    return new Query(store, model, id, opts);
  }


  create(model, state) {
    let store = this._getStoreForModel(model);
    return store.create(model, state);
  }

  update(model, state) {
    let store = this._getStoreForModel(model);
    return store.update(model, state);
  }

  delete(model, state) {
    let store = this._getStoreForModel(model);
    return store.delete(model, state);
  }

  commit() {
    return this._promise.all(this._storesThatCommit.map((storeName) => {
      return this._stores[storeName].commit();
    }));
  }

  dehydrate() {
    let state = {};

    state.storeMap = JSON.stringify(this._modelToStoreMap);
    state.stores = {};
    Object.keys(this._stores).forEach((store) => {
      state.stores[store] = this._stores[store].dehydrate();
    });

    return state;
  }

  rehydrate(state) {
    let storeMap = JSON.stringify(this._modelToStoreMap);
    if (state.storeMap !== storeMap) {
      // debug('Caution: restoring state from a different instance has undefined behavior');
    }

    Object.keys(state.stores).forEach((store) => {
      this._stores[store].rehydrate(state.stores[store]);
    });
  }
}

export default Elide;
