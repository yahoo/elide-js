/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

import uuid from 'uuid';
import jsonpatch from 'fast-json-patch';

import Datastore from './datastore';
import ChangeWatcher from '../helpers/change-watcher';
import clone from '../helpers/clone';
import debug from 'debug';

// jscs:disable maximumLineLength
export let ERROR_UNKNOWN_MODEL = 'Unknown model "${model}" passed to #${method}.';
export let ERROR_NO_UPSTREAM = 'No upstream store to commit to.';
export let ERROR_NO_STATE_GIVEN = 'No state passed to #${method}';
export let ERROR_CANNOT_FIND_ON_PROP = '"${property}" not a linked property on "${lastModel}".';
export let ERROR_CANNOT_CREATE_WITH_ID = 'Newly created records must not specify an id.';
export let ERROR_CANNOT_UPDATE_WITHOUT_ID = 'You must specify an id in order to modify a record.';
export let ERROR_CANNOT_UPDATE_MISSING_RECORD = 'The "${model}" passed to #${method} does not exist.';
export let ERROR_CANNOT_LINK_TO_MISSING_RECORD = 'The "${model}":${id} passed to #${method} does not exist.';
// jscs:enable maximumLineLength

let OWNS = '>';
let OWNED_BY = '<';
let HAS_ONE = 'hasOne';
let HAS_MANY = 'hasMany';

const log = debug('elide:memorystore');

class MemoryDatastore extends Datastore {
  constructor(Promise, ttl, baseURL, models) {
    super(Promise, ttl, baseURL, models);

    this._data = {};
    this._meta = {};
    this._ttlCache = {};

    let annotatedModels = clone(this._models);
    Object.keys(annotatedModels).forEach((modelName) => {
      let model = annotatedModels[modelName];
      this._data[modelName] = {};
      this._meta[modelName] = {};
      this._ttlCache[modelName] = {};

      Object.keys(model.links).forEach(function(link) {
        let linkage = model.links[link];

        annotatedModels[modelName][link] = linkage.type + OWNS + linkage.model;
        if (linkage.inverse) {
          annotatedModels[modelName][link] += '.' + linkage.inverse;
          annotatedModels[linkage.model][linkage.inverse] =
            linkage.type + OWNED_BY + modelName + '.' + link;
        }
      });

      delete annotatedModels[modelName].links;
    });

    this._models = annotatedModels;
    this._snapshot = clone(this._data);
  }

  /**
   *  checks to see if the model that we're looking for exists in our schema
   *  throws an error if the model isn't present
   *  @param  {string}  model  - the name of the model we're looking for
   *  @param  {string}  method - the name of the method we're calling from
   */
  _checkModel(model, method) {
    if (!this._models.hasOwnProperty(model)) {
      throw new Error(ERROR_UNKNOWN_MODEL
                        .replace('${model}', model)
                        .replace('${method}', method));
    }
  }

  /**
   * get a model template
   * @param   {string}  model - the name of the model
   * @return  {object}  a copy of the model definition
   */
   _getModelTemplate(model) {
     return clone(this._models[model]);
   }

  /**
   * get data from the store
   * @param   {string}  model - the name of the model
   * @param   {number}  id    - the model's id (could be string in case of uuid)
   * @return  {object} - a copy of the model
   */
  _getData(model, id) {
    let ttlExpiry = (new Date()).getTime() - this._ttl;
    id = this._meta[model][id] || id;
    if (this._ttlCache[model][id] && this._ttlCache[model][id] < ttlExpiry) {
      return undefined;
    }
    return clone(this._data[model][id]);
  }

  /**
   * set data into the store
   *
   * @param   {string}  model     - the name of the model
   * @param   {number}  instance  - the instance data to set
   */
  _setData(model, instance) {
    this._data[model][instance.id] = clone(instance);
  }

  /**
   * copy data returned from upstream into this store so we won't refetch
   * it if it gets queried again
   *
   * @param   {Query}   query   - the query executed upstream
   * @param   {Array}   results - the results returned from the upstream datastore
   */
  _setDataFromUpstreamQuery(query, results) {
    let model;

    if (results === undefined || results.length === 0) {
      return;
    }

    query._params.forEach((param) => {
      if (param.model) {
        model = param.model;

      } else {
        let modelTemplate = this._getModelTemplate(model);
        let linkDef = modelTemplate[param.field];
        [ , , model, ] = this._getLinkAttrs(linkDef);
      }
    });

    if (results instanceof Array) {
      for (let i = 0; i < results.length; i++) {
        let result = results[i];
        this._data[model][result.id] = result;
        this._ttlCache[model][result.id] = (new Date()).getTime();
        this._snapshot[model][result.id] = result;
      }

    } else {
      this._data[model][results.id] = results;
      this._ttlCache[model][results.id] = (new Date()).getTime();
      this._snapshot[model][results.id] = results;
    }
  }

  /**
   * delete data from the store
   * @param   {string}  model - the name of the model
   * @param   {number}  id    - the model's id (could be string in case of uuid)
   */
  _deleteData(model, id) {
    id = this._meta[model][id] || id;
    delete this._data[model][id];
  }

  /**
   * determine if the specified property is a link
   * @param   {string}  model - the name of the model
   * @param   {string}  prop  - the property to check
   * @return  {boolean} if the property is linked
   */
  _isLinkedProp(model, prop) {
    if (prop === 'meta') { return; }
    return this._models[model][prop].search(/hasOne|hasMany/) !== -1;
  }

  /**
   * get various attribues of a linkage between two models
   * @return [type, direction, toModel, toProp]
   *    type      - what kind of link (hasOne|hasMany)
   *    direction - OWNS or OWNED_BY
   *    toModel   - the name of a model
   *    toProp    - the name of the property on that model (may be `undefined`)
   */
  _getLinkAttrs(linkDef) {
    let matches = linkDef.match(/(hasOne|hasMany)(<|>)(\w+)(\.\w+)?/);
    let [ , type, direction, otherModel, otherProp] = matches;
    if (otherProp) {
      otherProp = otherProp.substr(1);
    }

    return [type, direction, otherModel, otherProp];
  }

  /**
   * check to ensure that the referenced object(s) exist
   * @param   {string} model        - the model we are verifying
   * @param   {number|Array} value  - an id or an array of ids
   * @param   {string} method       - the method checking these ids
   * @return  [willReject, withReason]
   *    willReject - false if all of the specified ids exist
   *    withReason - the error if `willReject == true`
   */
  _ensureReferencesExist(model, value, method) {
    let willReject = false;
    let withReason;

    if (!value) {
      return [willReject, withReason];
    }

    if (value instanceof Array) {
      for (let i = 0; i < value.length; i++) {
        if (!this._getData(model, value[i])) {
          willReject = true;
          withReason = ERROR_CANNOT_LINK_TO_MISSING_RECORD
                        .replace('${model}', model)
                        .replace('${id}', value[i])
                        .replace('${method}', method);
          break;
        }
      }

    } else if (!this._getData(model, value)) {
      willReject = true;
      withReason = ERROR_CANNOT_LINK_TO_MISSING_RECORD
                    .replace('${model}', model)
                    .replace('${id}', value)
                    .replace('${method}', method);
    }

    return [willReject, withReason];
  }

  /**
   * copy the atomic properties from `state` to `instance`
   * @param   {string}  model    - the type of `instance`
   * @param   {object}  instance - the object to modify
   * @param   {object}  state    - the new values for atomic properties of `instance`
   */
  _updateSimpleProps(model, instance, state) {
    let template = this._getModelTemplate(model);

    Object.keys(template).forEach((prop) => {
      if (this._isLinkedProp(model, prop) || prop === 'meta') {
        return;
      }
      if (instance.hasOwnProperty(prop) && !state.hasOwnProperty(prop)) {
        return;
      }

      instance[prop] = state[prop];
    });
  }

  /**
   * create the keys on `instance` with empty values so they can be iterated
   * @param   {object}  instance  - the object to receive the property
   * @param   {string}  prop      - the property
   * @param   {string}  type      - the type of the property
   * @param   {string}  direction - if the object is the root or leaf of the relationship
   */
  _setEmptyLinkedProperty(instance, prop, type, direction) {
    if (type === 'hasMany' && direction === OWNS) {
      instance[prop] = [];
    } else {
      instance[prop] = undefined;
    }
  }

  /**
   * add a leaf model to the root model. if the leaf is currently linked to a root we
   * will unlink it from it's current root
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _addSingleLeaf(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (rootInstance[rootProp] !== undefined) {
      // we need to unlink the current value
      let curLeaf = this._getData(leafModel, rootInstance[rootProp]);
      watcher.watchModel(curLeaf, leafModel);

      this._removeSingleLeaf(rootModel, rootProp, rootInstance,
                              leafModel, leafProp, curLeaf);
    }

    if (leafInstance === undefined) {
      rootInstance[rootProp] = undefined;
      return;
    }

    rootInstance[rootProp] = leafInstance.id;

    if (leafProp !== undefined) {
      // link the inverse
      if (leafInstance[leafProp]) {
        let curRoot = this._getData(rootModel, leafInstance[leafProp]);
        watcher.watchModel(curRoot, rootModel);

        this._removeSingleRoot(rootModel, rootProp, curRoot,
                                leafModel, leafProp, leafInstance);
      }

      leafInstance[leafProp] = rootInstance.id;
    }
  }

  /**
   * add a root model to the leaf model. if the root is currently linked to a leaf we
   * will unlink it from it's current leaf
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _addSingleRoot(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (leafInstance[leafProp] !== undefined) {
      let curRoot = this._getData(rootModel, leafInstance[leafProp]);
      watcher.watchModel(curRoot, rootModel);

      this._removeSingleRoot(rootModel, rootProp, curRoot,
                              leafModel, leafProp, leafInstance);
    }

    if (rootInstance === undefined) {
      leafInstance[leafProp] = undefined;
      return;
    }

    leafInstance[leafProp] = rootInstance.id;

    if (rootInstance[rootProp] !== undefined) {
      // we need to unlink the current value
      let curLeaf = this._getData(leafModel, rootInstance[rootProp]);
      watcher.watchModel(curLeaf, leafModel);

      this._removeSingleLeaf(rootModel, rootProp, rootInstance,
                              leafModel, leafProp, curLeaf);
    }

    rootInstance[rootProp] = leafInstance.id;
  }

  /**
   * remove a leaf from its current root
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _removeSingleLeaf(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (leafProp !== undefined) {
      leafInstance[leafProp] = undefined;
    }

    rootInstance[rootProp] = undefined;
  }

  /**
   * remove a root from its current leaf
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _removeSingleRoot(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    rootInstance[rootProp] = undefined;
    leafInstance[leafProp] = undefined;
  }

  /**
   * add a leaf to a root in a one-to-many property
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _addMultiLeaf(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (rootInstance[rootProp].indexOf(leafInstance.id) === -1) {
      rootInstance[rootProp].push(leafInstance.id);
    }

    if (leafProp !== undefined) {
      if (leafInstance[leafProp] !== rootInstance.id) {
        let curRoot = this._getData(rootModel, leafInstance[leafProp]);
        watcher.watchModel(curRoot, rootModel);

        this._removeMultiRoot(rootModel, rootProp, curRoot,
                              leafModel, leafProp, leafInstance);
      }

      leafInstance[leafProp] = rootInstance.id;
    }
  }

  /**
   * add a root to a leaf in a one-to-many property
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _addMultiRoot(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (rootInstance === undefined) {
      leafInstance[leafProp] = undefined;
      return;
    }

    if (rootInstance[rootProp].indexOf(leafInstance.id) === -1) {
      rootInstance[rootProp].push(leafInstance.id);
    }

    if (leafInstance[leafProp] !== rootInstance.id) {
      let curRoot = this._getData(rootModel, leafInstance[leafProp]);
      watcher.watchModel(curRoot, rootModel);

      this._removeMultiLeaf(rootModel, rootProp, curRoot,
                            leafModel, leafProp, leafInstance);
    }

    leafInstance[leafProp] = rootInstance.id;
  }

  /**
   * remove a leaf in a one-to-many property
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _removeMultiLeaf(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (rootInstance === undefined) {
      return;
    }

    if (rootInstance[rootProp].indexOf(leafInstance.id) !== -1) {
      rootInstance[rootProp] = rootInstance[rootProp].filter((ele) => {
        return ele !== leafInstance.id;
      });
    }

    if (leafProp !== undefined) {
      leafInstance[leafProp] = undefined;
    }
  }

  /**
   * unlink a leaf from a root in a one-to-many property
   * @param   {string}  rootModel      - the name of the root model
   * @param   {string}  rootProp       - the name of the property on the root
   * @param   {Object}  rootInstance   - the instance of the root model to link
   * @param   {string}  leafModel      - the name of the leaf model
   * @param   {string}  leafProp       - the name of the property on the leaf model
   * @param   {Object}  leafInstance   - the instance of the leaf model to link
   * @param   {ChangeWatcher}  watcher - the watcher which will gather changes to the involved objects
   */
  // jscs:disable maximumLineLength
  _removeMultiRoot(rootModel, rootProp, rootInstance, leafModel, leafProp, leafInstance, watcher) {
    // jscs:enable maximumLineLength
    if (rootInstance !== undefined) {
      rootInstance[rootProp] = rootInstance[rootProp].filter((ele) => {
        return ele !== leafInstance.id;
      });
    }

    if (leafProp !== undefined) {
      leafInstance[leafProp] = undefined;
    }
  }

  /**
   * updates the properties on an object that are links to other models
   * @param   {string}   model       - the name of the model we are modifying
   * @param   {Object}   instance    - the instance of `model` we are updating
   * @param   {Object}   state       - the new state for `instance`
   * @param   {boolean}  createProps - a flag that will create empty instances of the properties on `instance`
   * @param   {string}   method      - where this is being called from (for error tracking)
   */
  _updateLinkProperties(model, instance, state, createProps, method) {
    let willReject = false;
    let withReason;

    let watcher = new ChangeWatcher();
    let template = this._getModelTemplate(model);

    watcher.watchModel(instance, model);

    // relational properties in the second pass
    Object.keys(template).some((prop) => {
      if (!this._isLinkedProp(model, prop)) {
        return false;
      }

      let value = instance[prop];
      if (state.hasOwnProperty(prop)) {
        value = state[prop];
      }
      // properties which link to other models
      let [
        type,
        direction,
        otherModel,
        otherProp
      ] = this._getLinkAttrs(template[prop]);

      if (createProps) {
        this._setEmptyLinkedProperty(instance, prop, type, direction);
      }

      if (!value && type === HAS_MANY && direction === OWNS) {
        value = [];
      }

      [
        willReject,
        withReason
      ] = this._ensureReferencesExist(otherModel, value, method);
      if (willReject) {
        return true;
      }

      if (type === HAS_ONE) {
        if (direction === OWNS) {
          let leaf = this._getData(otherModel, value);
          watcher.watchModel(leaf, otherModel);
          this._addSingleLeaf(model, prop, instance,
                              otherModel, otherProp, leaf, watcher);

        } else {
          let root = this._getData(otherModel, value);
          watcher.watchModel(root, otherModel);
          this._addSingleRoot(otherModel, otherProp, root,
                              model, prop, instance, watcher);

        }

      } else if (type === HAS_MANY) {
        if (direction === OWNS) {
          let toRemove = instance[prop].filter((element) => {
            return value.indexOf(element) === -1;
          });
          for (let i = 0; i < toRemove.length; i++) {
            let leaf = this._getData(otherModel, toRemove[i]);
            watcher.watchModel(leaf, otherModel);

            this._removeMultiLeaf(model, prop, instance,
                                  otherModel, otherProp, leaf, watcher);
          }

          for (let i = 0; i < value.length; i++) {
            let leaf = this._getData(otherModel, value[i]);
            watcher.watchModel(leaf, otherModel);

            this._addMultiLeaf(model, prop, instance,
                                otherModel, otherProp, leaf, watcher);
          }

        } else {
          let root = this._getData(otherModel, value);
          watcher.watchModel(root, otherModel);

          this._addMultiRoot(otherModel, otherProp, root,
                              model, prop, instance, watcher);
        }
      }
    });

    let patches = watcher.getPatches();

    return [patches, willReject, withReason];
  }

  //
  // Datastore implementation
  //
  find(query) {
    let willReject = false;
    let withReason;
    let foundObject;
    let foundObjects = [];
    let wantsCollection = false;

    let lastModel;
    let modelTemplate;

    // call for error handling, ignore return value
    super.find(query);

    query._params.some((param) => {
      let field = param.field;
      if (param.model) {
        lastModel = param.model;
        modelTemplate = this._getModelTemplate(lastModel);

      } else if (!this._isLinkedProp(lastModel, field)) {
        willReject = true;
        withReason = ERROR_CANNOT_FIND_ON_PROP
                      .replace('${model}', lastModel)
                      .replace('${property}', field);
        return true;

      } else {
        let linkDef = modelTemplate[param.field];
        [ , , lastModel, ] = this._getLinkAttrs(linkDef);
        modelTemplate = this._getModelTemplate(lastModel);
      }
      this._checkModel(lastModel, 'find');
    });

    if (willReject) {
      return this._promise.reject(new Error(withReason));
    }

    let getIdsFromField = function(obj, field) {
      if (obj[field] instanceof Array) {
        return obj[field];
      } else {
        return [obj[field]];
      }
    };
    for (let i = 0; i < query._params.length; i++) {
      let param = query._params[i];
      let field = param.field;
      wantsCollection = param.id === undefined;

      if (i === 0) {
        lastModel = param.model;

      } else {
        let linkDef = this._getModelTemplate(lastModel)[field];
        [ , , lastModel, ] = this._getLinkAttrs(linkDef);
      }

      let allIds = [];
      if (foundObject) {
        allIds = getIdsFromField(foundObject, field);

      } else if (foundObjects.length > 0) {
        for (let i = 0; i < foundObjects.length; i++) {
          let obj = foundObjects[i];
          allIds = allIds.concat(getIdsFromField(obj, field));
        }

      } else if (wantsCollection) {
        allIds = Object.keys(this._data[lastModel]);

      } else {
        allIds = [param.id];
      }

      if (wantsCollection) {
        foundObjects = [];
        foundObject = undefined;
        for (let i = 0; i < allIds.length; i++)  {
          let id = allIds[i];
          let obj = this._getData(lastModel, id);
          if (obj) {
            foundObjects.push(obj);
          }
        }

      } else {
        let foundId;
        if (allIds.indexOf(param.id) !== -1) {
          foundId = param.id;
        }

        foundObject = this._getData(lastModel, foundId);
        foundObjects = [];
      }

      if (!wantsCollection && foundObject === undefined ||
          wantsCollection && foundObjects.length === 0) {
        break;
      }
    }

    if (this._upstream !== undefined &&
        foundObject === undefined &&
        foundObjects.length === 0) {
      log('Query not fulfilled locally, going upstream');
      return this._upstream.find(query).then((upstreamResults) => {
        this._setDataFromUpstreamQuery(query, upstreamResults);
        return upstreamResults;

      }, (upstreamErr) => {
        throw upstreamErr;
      });
    }

    let result = wantsCollection ? foundObjects : foundObject;
    return this._promise.resolve(result);
  }

  create(model, state) {
    this._checkModel(model, 'create');
    let willReject = false;
    let withReason;

    let toReturn;
    let toCreate = {};

    if (!state) {
      let err = new Error(ERROR_NO_STATE_GIVEN.replace('${method}', 'create'));
      return this._promise.reject(err);

    } else if (state.id) {
      let err = new Error(ERROR_CANNOT_CREATE_WITH_ID);
      return this._promise.reject(err);

    } else {
      let id = uuid.v4();
      toCreate.id = id;

      let relationPatches = [];

      this._updateSimpleProps(model, toCreate, state);

      // we link objects by applying patches after we determine that the operation
      // will succeed, so we need to create a copy so that we can insert the unlinked
      // version into our store and return the linked version to the client
      toReturn = clone(toCreate);

      [
        relationPatches,
        willReject,
        withReason
      ] = this._updateLinkProperties(model, toReturn, state, true, 'create');

      if (!willReject) {
        this._setData(model, toCreate);
        jsonpatch.apply(this._data, relationPatches);
      } else {
        return this._promise.reject(new Error(withReason));
      }
    }

    return this._promise.resolve(toReturn);
  }

  update(model, state) {
    this._checkModel(model, 'update');
    let willReject = false;
    let withReason;

    let toUpdate;

    if (!state) {
      let err = new Error(ERROR_NO_STATE_GIVEN
                    .replace('${method}', 'update'));
      return this._promise.reject(err);

    } else if (!state.id) {
      let err = new Error(ERROR_CANNOT_UPDATE_WITHOUT_ID);
      return this._promise.reject(err);

    } else if (!this._getData(model, state.id)) {
      let err = new Error(ERROR_CANNOT_UPDATE_MISSING_RECORD
                    .replace('${model}', model)
                    .replace('${method}', 'update'));
      return this._promise.reject(err);

    } else {
      let relationPatches = [];

      toUpdate = this._getData(model, state.id);

      this._updateSimpleProps(model, toUpdate, state);
      [
        relationPatches,
        willReject,
        withReason
      ] = this._updateLinkProperties(model, toUpdate, state, false, 'update');

      if (!willReject) {
        jsonpatch.apply(this._data, relationPatches);
        this._setData(model, toUpdate);
      } else {
        return this._promise.reject(new Error(withReason));
      }
    }

    return this._promise.resolve(toUpdate);
  }

  delete(model, state) {
    this._checkModel(model, 'delete');
    let willReject = false;
    let withReason;

    if (!state) {
      let err = new Error(ERROR_NO_STATE_GIVEN.replace('${method}', 'delete'));
      return this._promise.reject(err);

    } else if (!state.id) {
      let err = new Error(ERROR_CANNOT_UPDATE_WITHOUT_ID);
      return this._promise.reject(err);

    } else if (!this._getData(model, state.id)) {
      let err = new Error(ERROR_CANNOT_UPDATE_MISSING_RECORD
                    .replace('${model}', model)
                    .replace('${method}', 'delete'));
      return this._promise.reject(err);

    } else {
      this._deleteData(model, state.id);
    }

    return this._promise.resolve();
  }

  /**
   * commit pushes all pending operations upstream
   *
   * @param  {none} _    - we ignore this value in the memorydatastore
   * @return {Promise}   - the promise resolves if the commit succeedes and rejects if the
   *                       commit fails, in either case there is no return value. If the promise
   *                       local copys of objects be refetched after the commit if the promise
   *                       rejects or if the promise succeedes and is called with `true`
   */
  commit(_) {
    let willReject = false;

    if (!this._upstream) {
      return this._promise.reject(new Error(ERROR_NO_UPSTREAM));
    }

    let patches = jsonpatch.compare(this._snapshot, this._data);

    return this._upstream.commit(patches).then((upstreamResults) => {
      if (upstreamResults) {
        for (let i = 0; i < upstreamResults.length; i++) {
          let result = upstreamResults[i];

          let type = result.type;
          let data = result.data;
          let curId = data.id;
          let lastId = result.oldId;

          if (lastId && lastId !== curId) {
            this._meta[type][lastId] = curId;
            delete this._data[type][lastId];
          }

          this._data[type][curId] = data;
        }
      }

      this._snapshot = clone(this._data);
      return this._promise.resolve();

    }, (upstreamError) => {
      this._data = clone(this._snapshot);
      throw upstreamError;
    });
  }

  dehydrate() {
    let dehydratedData = JSON.stringify(this._data);
    let dehydratedSnapshot = JSON.stringify(this._snapshot);

    if (dehydratedData !== dehydratedSnapshot) {
      throw new Error('Cannot dehydrate MemoryStore with uncommitted data');
    }

    let dehydratedMeta = JSON.stringify(this._meta);

    return {
      dehydratedMeta,
      dehydratedData
    };
  }

  rehydrate(state) {
    let {
      dehydratedMeta,
      dehydratedData
    } = state;

    this._data = JSON.parse(dehydratedData);
    this._meta = JSON.parse(dehydratedMeta);
    this._snapshot = clone(this._data);
  }
}

export default MemoryDatastore;
