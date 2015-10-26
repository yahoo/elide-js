/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

import debug from 'debug';
import agent from 'superagent';
import wrap from 'superagent-promise';

import Datastore from './datastore';

let SuperAgent;
const UUID = /[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}/;

// housekeeping for SuperAgent
const JSONAPI_MIME_TYPE = 'application/vnd.api+json';
const JSONPATCH_MIME_TYPE = 'application/vnd.api+json; ext=jsonpatch';
agent.serialize[JSONAPI_MIME_TYPE] = JSON.stringify;
agent.serialize[JSONPATCH_MIME_TYPE] = JSON.stringify;

// jscs:disable maximumLineLength
export const ERROR_UNKNOWN_MODEL = 'The model ${model} does not exist in this store.';
export const ERROR_NO_LINKED_PROPERTY = 'The model ${model} does not have a linked property ${property}.';
export const ERROR_CANNOT_ROOT_QUERY = 'Query cannot be fulfilled because "${model}":${id} cannot be associated with a "${nextModel}".';
export const ERROR_CANNOT_ROOT_OBJECT = 'Cannot root ${model}:${modelState} through ${parentModel}.';
export const ERROR_CANNOT_FIND_OBJECT = 'Could not find ${model}.';
export const ERROR_CANNOT_CREATE_OBJECT = 'Could not create ${model}:${modelState}.';
export const ERROR_CANNOT_UPDATE_OBJECT = 'Could not update ${model}:${modelState}.';
export const ERROR_CANNOT_DELETE_OBJECT = 'Could not delete ${model}:${modelState}.';
export const ERROR_SCHEMA_INCONSISTENCY = 'Internal inconsistency in schema ${model} url does not have ${model} as the final model.';
// jscs:enable maximumLineLength

const basicDebug = debug('elide:jsonApi');
const extendedDebug = debug('elide:jsonApi-detailed');
const MAX_BODY_TEXT_LENGTH = 1000;

function printDebug(error) {
  let requestData;
  let responseError;
  let responseStatus;
  let errorText;
  try {
    responseStatus = error.status;
    responseError = error.response.error;
    requestData = error.response.request._data;

    if (responseError.text.length > MAX_BODY_TEXT_LENGTH) {
      errorText = responseError.text;
      delete responseError.text;
    }
  } catch (e) {
    basicDebug(e);
    extendedDebug(e);
  }

  basicDebug(responseStatus);
  basicDebug(responseError);

  extendedDebug('request.data:', JSON.stringify(requestData, null, 2));
  extendedDebug('code:', responseStatus);
  extendedDebug('error:', responseError);

  try {
    responseError.text = errorText;
  } catch (e) {}
}

class JsonApiDatastore extends Datastore {
  constructor(Promise, ttl, baseURL, models) {
    super(Promise, ttl, baseURL, models);

    this._urlTemplateCache = {};
    this._relationCache = {};
    this._aliasIds = {};

    this._headers = {};
    this._queryParameters = {};

    this._rootModels(models);
    this._annotateModels(models);
    this._modelHierarchy = this._buildModelHierarchy();
    this._initSuperAgent(Promise);
  }

  /**
   * generates a set of URIs for the model objects
   *
   * @param  {Object}    models - the models passed to the constructor
   */
  _rootModels(models) {
    let topLevel = [];
    Object.keys(models).forEach((modelName) => {
      let model = models[modelName];
      if (model.meta.isRootObject) {
        topLevel.push(modelName);
        this._urlTemplateCache[modelName] =
          `/${modelName}/:${modelName}Id|${modelName}`;
      }
    });
    topLevel.forEach((modelName) => {
      this._rootChildModels(modelName);
    });
  }

  /**
   * generates URL templates for models recursively
   * @param  {String}            modelName - the name of a model to root
   * NB: this is a naïve way to do it, if a model is linked from many
   * places we only keep the deepest one
   */
  _rootChildModels(modelName) {
    let linkNames = Object.keys(this._models[modelName].links || {});
    let parentURI = this._urlTemplateCache[modelName].split('|');
    let parentUrl = parentURI.shift();
    let parentModels = parentURI.join('|');

    linkNames.forEach((linkName) => {
      let link = this._models[modelName].links[linkName];
      let thisModels = `${parentModels}|${link.model}`;
      // TODO: this should probably turn into a tree of routes that we can use
      //       to select the best url for a given model (in case there may be
      //       more than one URL that can express the same model).
      //       EG. use /people/2 not /people/1/spouse/2
      if (this._urlTemplateCache.hasOwnProperty(link.model)) { return; }
      this._urlTemplateCache[link.model] =
        `${parentUrl}/${linkName}/:${link.model}Id|${thisModels}`;

      // recurse to get to all models
      this._rootChildModels(link.model);
    });
  }

  /**
   * put inverse annotations on the store's models
   * @param  {Object}        models - the models passed to the constructor
   */
  _annotateModels(models) {
    Object.keys(models).forEach((modelName) => {
      this._models[modelName].meta.inverse = {};
    });

    Object.keys(models).forEach((modelName) => {
      let model = models[modelName];
      Object.keys(model.links).forEach((linkName) => {
        let link = model.links[linkName];
        if (link.hasOwnProperty('inverse')) {
          this._models[link.model].meta.inverse[link.inverse] = modelName;
        }
      });
    });
  }

  /**
   * build an array of models, starting with the root models and working to the
   * most deeply nested models
   * @return {Array}             The models in order of nesting depth
   */
  _buildModelHierarchy() {
    let models = [];
    let inList = {};
    let hierarchy = [];

    // start from the root level
    Object.keys(this._models).forEach((model) => {
      let template = this._models[model];
      if (!template.links) { return; }
      if (!template.meta.isRootObject) { return; }

      models.push(model);
      inList[model] = true;
      Object.keys(template.links).forEach((linkName) => {
        let link = template.links[linkName];
        if (!inList[link.model]) {
          models.push(link.model);
          inList[link.model] = true;
        }
      });
    });

    hierarchy = hierarchy.concat(models);
    while (models.length > 0) {
      let newModels = [];
      for (let i = 0; i < models.length; i++) {
        let template = this._models[models[i]];
        if (!template.links) { continue; }

        Object.keys(template.links).forEach((linkName) => {
          let link = template.links[linkName];
          if (!inList[link.model]) {
            newModels.push(link.model);
            inList[link.model] = true;
          }
        });
      }
      hierarchy = hierarchy.concat(newModels);
      models = newModels;
    }

    return hierarchy;
  }

  /**
   * wrap SuperAgent to use promises
   * @param  {Promise}        Promise - the Promise that superagent should return
   */
  _initSuperAgent(Promise) {
    if (!SuperAgent) {
      SuperAgent = wrap(agent, Promise);
    }
  }

  /**
   * get an absolute URL for a resource
   * @param  {String}     resourceUrl - the relative URL for the resource
   * @return {String}                 - the fully specified URL
   */
  _absoluteUrl(resourceUrl) {
    if (!this._computedQueryParams || this._computedQueryParams.length === 0) {
      this._computedQueryParams = Object.keys(this._queryParameters)
        .reduce((input, key) => {
          return `${input}${key}=${this._queryParameters[key]}&`;
        }, '?');
      let lastIndex = this._computedQueryParams.length - 1;
      if (this._computedQueryParams.charAt(lastIndex) === '&') {
        this._computedQueryParams.slice(0, lastIndex);
      }
    }

    return `${this._baseURL}${resourceUrl}${this._computedQueryParams}`;
  }

  /**
   * for debugging
   */
  _uriForModel(model, id) {
    let willReject;
    let withReason;
    let requiredModels = this._urlTemplateCache[model].split('|');
    let modelUrl = requiredModels.shift();

    let fromModel = {
      model: requiredModels.pop(),
      id,
    };

    [
      willReject,
      withReason,
      modelUrl
    ] = this._rootModel(modelUrl, requiredModels, fromModel);
    modelUrl = modelUrl.replace(`:${model}Id`, id);

    if (willReject) {
      throw new Error(`Could not root ${model}:${id} because '${withReason}'` +
                      `Wound up with ${modelUrl}`);
    }
    return modelUrl;
  }

  /**
   * resolve a query's url
   *
   * @param  {String}   modelUrl        - the query url with missing parameters
   * @param  {Array}    missingModels   - the array of models we haven't resolved yet
   * @param  {Object}   fromModel
   * @param  {Number}   fromModel.id    - the id of shallowest model we have resolved
   * @param  {String}   fromModel.model - the name of the shallowest model we have resolved
   * @return {Array}   [
   *         							willReject,    - `true` if we failed to fully resolve the query
   *         						 	withReason,    - the reason we failed to fully resolve the query
   *         						  modelUrl       - the fully resolved query url
   *         						]
   */
  _rootModel(modelUrl, missingModels, fromModel) {
    let willReject = false;
    let withReason;

    let model = fromModel.model;
    let objId = fromModel.id;
    modelUrl = modelUrl.replace(`:${fromModel.model}Id`, objId || '');
    while (missingModels.length > 0) {
      let nextModel = missingModels.pop();
      let link = this._findLinkingObject(nextModel, model, objId);
      if (!link) {
        willReject = true;
        withReason = ERROR_CANNOT_ROOT_QUERY
                      .replace('${nextModel}', nextModel)
                      .replace('${model}', model)
                      .replace('${id}', objId);
        break;
      }

      objId = link;
      model = nextModel;
      modelUrl = modelUrl.replace(`:${nextModel}Id`, objId);
    }

    return [
      willReject,
      withReason,
      modelUrl
    ];
  }

  /**
   * Add a id alias, used when we create objects with uuids
   *
   * @param {String} newId - the newly generated ID
   * @param {String} oldId - the ID from creation time
   */
  _setAlias(newId, oldId) {
    this._aliasIds[newId] = oldId;
  }

  /**
   * Associate two models so that we can use them to root other queries
   *
   * @param  {String}    fromModel - the parent model
   * @param  {Number}    fromId    - the id of the parent model
   * @param  {String}    toModel   - the child model
   * @param  {Number}    toId      - the id of the child model
   */
  _linkModels(fromModel, fromId, toModel, toId) {
    if (!this._relationCache.hasOwnProperty(fromModel)) {
      this._relationCache[fromModel] = {};
    }
    if (!this._relationCache[fromModel].hasOwnProperty(toModel)) {
      this._relationCache[fromModel][toModel] = {};
    }

    this._relationCache[fromModel][toModel][toId] = fromId;
  }

  /**
   * find an object of type `fromModel` that is parent to `toModel`:`toId`
   *
   * @param  {String}           fromModel - the parent model
   * @param  {String}           toModel   - the child model
   * @param  {Number}           toId      - the child model's Id
   * @return {Number}                     - the id of the parent model
   */
  _findLinkingObject(fromModel, toModel, toId) {
    let fromId;
    let alias = this._aliasIds[toId];

    /*
     * Link up the tree
     */
    if (!this._relationCache.hasOwnProperty(fromModel) ||
        !this._relationCache[fromModel].hasOwnProperty(toModel)) {

      if (this._relationCache.hasOwnProperty(toModel) &&
          this._relationCache[toModel].hasOwnProperty(fromModel)) {
        Object.keys(this._relationCache[toModel][fromModel]).some((key) => {
          if (this._relationCache[toModel][fromModel][key] === toId) {
            fromId = key;
            return true;
          }
          if (this._relationCache[toModel][fromModel][key] === alias) {
            this._relationCache[toModel][fromModel][key] = toId;
            fromId = key;
            return true;
          }
        });
      }
      return fromId;

    }

    /*
     * Link down the tree
     */
    fromId = this._relationCache[fromModel][toModel][toId];
    if (!fromId && this._relationCache[fromModel][toModel].hasOwnProperty(alias)) {
      this._relationCache[fromModel][toModel][toId] =
        this._relationCache[fromModel][toModel][alias];
      delete this._relationCache[fromModel][toModel][alias];
    }
    return this._relationCache[fromModel][toModel][toId];
  }

  /**
   * find the name of a property that links parent to child
   *
   * @param  {String}             parentModel - the parent model
   * @param  {String}             childModel  - the child model
   * @return {String}                         - the name of the inverse property on childModel
   */
  _findLinkingProperty(parentModel, childModel) {
    let prop;
    let template = this._models[parentModel];
    Object.keys(template.links).some(function(linkName) {
      let link = template.links[linkName];
      if (link.model === childModel && link.hasOwnProperty('inverse')) {
        prop = link.inverse;
        return true;
      }
    });

    return prop;
  }

  /**
   * convert a JSON API representation of an object back into a the local format
   *
   * @param  {Object}       apiObject - a JSON API representation of a model
   * @return {Object}                 - the local representation of the model
   */
  _fromApiObject(apiObject) {
    let template = this._models[apiObject.type];
    let projection = {
      id: apiObject.id
    };

    Object.keys(apiObject.attributes).forEach(function(attr) {
      if (!template.hasOwnProperty(attr)) { return; }
      projection[attr] = apiObject.attributes[attr];
    });

    if (!template.links) {
      return projection;
    }

    let relationships = apiObject.relationships;
    let setEmptyLink = function(object, link, type) {
      if (type === 'hasOne') {
        object[link] = null;
      } else {
        object[link] = [];
      }
    };
    if (relationships) {
      Object.keys(template.links).forEach((rel) => {
        let type = template.links[rel].type;
        if (!relationships.hasOwnProperty(rel)) {
          setEmptyLink(projection, rel, type);
          return;
        }

        let relationship = relationships[rel].data;
        if (relationship === null || relationship === []) {
          setEmptyLink(projection, rel, type);

        } else if (type === 'hasOne') {
          projection[rel] = relationship.id;
          this._linkModels(apiObject.type, apiObject.id,
                            relationship.type, relationship.id);

        } else {
          projection[rel] = relationship.map((linkage) => {
            this._linkModels(apiObject.type, apiObject.id,
                              linkage.type, linkage.id);
            return linkage.id;
          });
          // TODO: Remove this once it gets implemented in Elide-WS
          projection[rel].sort();
        }
      });
      Object.keys(template.meta.inverse).forEach((inverse) => {
        if (!relationships.hasOwnProperty(inverse)) {
          setEmptyLink(projection, inverse, 'hasOne');
          return;
        }

        projection[inverse] = relationships[inverse].data.id;
        this._linkModels(apiObject.type, apiObject.id,
          template.meta.inverse[inverse], projection[inverse]);
      });
    } else {
      Object.keys(template.links).forEach(function(rel) {
        setEmptyLink(projection, rel, template.links[rel].type);
      });
      Object.keys(template.meta.inverse).forEach(function(inverse) {
        setEmptyLink(projection, inverse, 'hasOne');
      });
    }

    return projection;
  }

  /**
   * transforms a response from the server
   *
   * @param  {SuperAgent.response}         response - the response from the server
   * @return {Object || Array}                  - the object or set of objects returned from the server
   */
  _transformResult(response) {
    if (response.status === 204) {
      return;
    }
    let jsonData = response.body || JSON.parse(response.text);

    let results;
    if (jsonData.data instanceof Array) {
      results = [];
      for (let i = 0; i < jsonData.data.length; i++) {
        results.push(this._fromApiObject(jsonData.data[i]));
      }

    } else {
      results = this._fromApiObject(jsonData.data);
    }

    return results;
  }

  /**
   * transforms a local representation of a model and transforms it into the
   * corresponding JSON API format
   *
   * @param  {String}          model  - the name of the model being passed in
   * @param  {Object}          toSend - the local representation
   * @return {Object}                 - the JSON API formatted object
   */
  _transformRequest(model, toSend, fillBlanks) {
    let payload = {
      data: {
        type: model,
        id: toSend.id,
        attributes: {},
        relationships: {}
      }
    };
    let template = this._models[model];
    Object.keys(template).forEach((key) => {
      if (key === 'links' || key === 'meta') {
        return;
      }
      if (toSend.hasOwnProperty(key) || fillBlanks) {
        payload.data.attributes[key] = toSend.hasOwnProperty(key) ?
                                        toSend[key] :
                                        null;
      }
    });
    Object.keys(template.links).forEach((linkName) => {
      if (!toSend.hasOwnProperty(linkName) && !fillBlanks) {
        // if we are creating an object directly (not via the MemoryDataStore)
        // then we may hit this case
        return;
      }

      let link = template.links[linkName];
      let data;
      if (link.type === 'hasOne') {
        if (!toSend[linkName]) {
          data = null;

        } else {
          data = {
            type: link.model,
            id: toSend[linkName]
          };
        }

      } else if (link.type === 'hasMany') {
        if (!toSend[linkName] || toSend[linkName].length === 0) {
          data = [];

        } else {
          data = toSend[linkName].map(function(member) {
            return {
              type: link.model,
              id: member
            };
          });
        }
      }

      payload.data.relationships[linkName] = {data};
    });

    Object.keys(template.meta.inverse).forEach((inverse) => {
      if (!toSend.hasOwnProperty(inverse) && !fillBlanks) {
        // if we are creating an object directly (not via the MemoryDataStore)
        // then we may hit this case
        return;
      }

      let data = null;
      if (toSend[inverse]) {
        data = {
          type: template.meta.inverse[inverse],
          id: toSend[inverse]
        };
      }

      payload.data.relationships[inverse] = {data};
    });

    return payload;
  }

  /**
   * determine the URI for a new non-root model
   *
   * @param  {String}      model - the model
   * @param  {String}      id    - the id of the new thing
   * @param  {Object}      state - the new state of the new thing (in JSON API format)
   * @return @see #_rootModel
   */
  _rootNewModel(model, id, state) {
    let rootPath;

    let requiredModels = this._urlTemplateCache[model].split('|');
    rootPath = requiredModels.shift();
    requiredModels.pop(); // drop the last model (which == `model`)
    rootPath = rootPath.replace(`:${model}Id`, ''); // remove id in uri
    if (requiredModels.length === 0) {
      return [
        false,
        '',
        rootPath
      ];
    }

    let lastModel = requiredModels.pop();
    let prop = this._findLinkingProperty(lastModel, model);
    if (!prop) {
      return [
        true,
        ERROR_CANNOT_ROOT_OBJECT.replace('${model}', model)
          .replace('${modelState}', JSON.stringify(state))
          .replace('${parentModel}', lastModel),
        ''
      ];
    }
    let fromModel = {
      model: lastModel,
      id: state.relationships[prop].data.id
    };

    return this._rootModel(rootPath, requiredModels, fromModel);
  }

  /**
   * return the URI for a request about the object withData
   *
   * @param  {String}        model         - the model
   * @param  {Boolean}       getCollection - if we should return the collection endpoint
   * @param  {Object}        withData      - the state of the model
   * @return @see #_rootModel
   */
  _getUrlForModel(model, getCollection, withData) {
    let willReject = false;
    let withReason;

    let modelUrl = this._urlTemplateCache[model];
    let requiredModels = modelUrl.split('|');
    modelUrl = requiredModels.shift();

    if (requiredModels.pop() !== model) {
      willReject = true;
      withReason = ERROR_SCHEMA_INCONSISTENCY
                    .replace('${model}', model)
                    .replace('${model}', model);
    }
    modelUrl = modelUrl.replace(`:${model}Id`, getCollection ?
                                                  '' :
                                                  withData.id);

    if (!willReject && requiredModels.length > 0) {
      // find the next top level model
      let parentModel = requiredModels.pop();
      let linkingProp = this._findLinkingProperty(parentModel, model);
      let linkId = withData[linkingProp] ||
                    this._findLinkingObject(parentModel, model, withData.id);
      if (!linkingProp || !linkId) {
        willReject = true;
        withReason = ERROR_CANNOT_ROOT_OBJECT
                      .replace('${model}', model)
                      .replace('${modelState}', JSON.stringify(withData))
                      .replace('${parentModel}', parentModel);

      } else {
        let fromModel = {
          model: parentModel,
          id: linkId
        };

        // get the full query
        [
          willReject,
          withReason,
          modelUrl
        ] = this._rootModel(modelUrl, requiredModels, fromModel);
      }
    }

    return [
      willReject,
      withReason,
      modelUrl
    ];
  }

  /**
   * transform a list of json patches and group them by object
   *
   * @param  {Array}      patches - the patches to group
   * @return {Object}             - the grouped patches
   */
  _parseObjects(patches) {
    let objects = {};

    patches.forEach((patch) => {
      let [ , model, id, ...path] = patch.path.split('/');
      let template = this._models[model];
      path = path.join('/');
      patch.path = path;

      // transform value into jsonapi thingy
      if (patch.op === 'add' && patch.path === '') {
        patch.value = this._transformRequest(model, patch.value, true).data;
      } else if (template.hasOwnProperty(path)) {
        let value = patch.value;
        patch.path = '';
        patch.value = {
          id,
          type: model,
          attributes: {}
        };
        patch.value.attributes[path] = value;
      }

      if (!objects.hasOwnProperty(model)) {
        objects[model] = {};
      }
      if (!objects[model].hasOwnProperty(id)) {
        objects[model][id] = [];
      }
      objects[model][id].push(patch);
    });

    return objects;
  }

  /**
   * turn a flat grouping of patches into a relational tree
   *
   * @param  {Object}     objectDiffs - the grouping of patches
   * @param  {String}     model       - the model to pull out of the grouping
   * @param  {Object}     fromObjects - the collection where we will nest the patches we pull out
   * @return `fromObjects` is mutated and constitues the return value
   */
  _rollUpDiffs(objectDiffs, model, fromObjects) {
    let template = this._models[model];
    if (!template.links) { return; }

    Object.keys(fromObjects).forEach((id) => {
      let diffs = fromObjects[id].diffs;
      let newState;
      // new objects should only have one diff
      if (id.search(UUID) !== -1) {
        newState = diffs[0].value;
      } else {
        let relationships = {};
        for (let i = 0; i < diffs.length; i++) {
          let diff = diffs[i];
          if (template.links.hasOwnProperty(diff.path)) {
            relationships[diff.path] = {
              data: {
                type: template.links[diff.path].model,
                id: diff.value
              }
            };
          }
        }
        newState = {relationships};
      }

      Object.keys(template.links).forEach((linkName) => {
        let link = template.links[linkName];
        let linked = {};
        if (!newState.relationships.hasOwnProperty(linkName)) { return; }

        let linkage = newState.relationships[linkName].data;
        if (!linkage) { return; }

        if (linkage instanceof Array) {
          for (let i = 0; i < linkage.length; i++) {
            let cur = linkage[i];
            if (!objectDiffs[cur.type][cur.id]) { continue; }

            linked[cur.id] = {
              diffs: objectDiffs[cur.type][cur.id]
            };
            delete objectDiffs[cur.type][cur.id];
          }

        } else {
          if (!objectDiffs[linkage.type] ||
              !objectDiffs[linkage.type][linkage.id]) { return;}

          linked[linkage.id] = {
            diffs: objectDiffs[linkage.type][linkage.id]
          };
          delete objectDiffs[linkage.type][linkage.id];
        }

        this._rollUpDiffs(objectDiffs, link.model, linked);
        fromObjects[id][linkName] = linked;
      });

    });
  }

  /**
   * take a tree of patches and return an array of patches with `path`s that
   * mirror their ordering in the tree
   *
   * @param  {Object}   diffTree - the tree of diffs to flatten
   * @return {Array}             - the diffs whose `path` property has been modified
   */
  _rootDiffs(diffTree) {
    let rootedDiffs = [];

    let rootDiffs = function rootDiffs(parentPath, objectId, object) {
      let diffs = [];

      for (let i = 0; i < object.diffs.length; i++) {
        let diff = object.diffs[i];
        let path = diff.path ? `/${diff.path}` : '';
        if (diff.op === 'remove' && diff.path === '') {
          path = `/${objectId}`;
        }
        diff.path = `${parentPath}${path}`;
        diffs.push(diff);
      }
      Object.keys(object).forEach(function(key) {
        if (key === 'diffs') { return; }
        Object.keys(object[key]).forEach(function(id) {
          diffs = diffs.concat(
            rootDiffs(`${parentPath}/${objectId}/${key}`, id, object[key][id])
          );
        });
      });

      return diffs;
    };

    Object.keys(diffTree).forEach((model) => {
      let template = this._models[model];
      let isRoot = template.meta.isRootObject;

      let models = diffTree[model];
      if (isRoot) {
        Object.keys(models).forEach((id) => {
          rootedDiffs = rootedDiffs.concat(rootDiffs(model, id, models[id]));
        });

      } else {
        Object.keys(models).forEach((id) => {
          let willReject;
          let withReason;
          let rootPath;
          let diff = models[id].diffs[0];

          if (models[id].diffs.length === 1 && diff.path === '') {
            // we are creating an object
            [
              willReject,
              withReason,
              rootPath
            ] = this._rootNewModel(model, id, diff.value);
          } else {
            // we are modifiying an object
            let requiredModels = this._urlTemplateCache[model].split('|');
            let modelURI = requiredModels.shift();
            requiredModels.pop();
            [
              willReject,
              withReason,
              rootPath
            ] = this._rootModel(modelURI, requiredModels, {model, id});
          }

          rootedDiffs = rootedDiffs.concat(rootDiffs(rootPath, id, models[id]));
        });
      }
    });

    return rootedDiffs;
  }

  _createError(withMessage, modelUrl, error) {
    let err = new Error(withMessage);

    let resourceUrl;
    let requestUrl;
    let requestData;
    let responseStatus;
    let responseText;
    try {
      resourceUrl = modelUrl;
      requestUrl = this._absoluteUrl(modelUrl);
      requestData = error.response.request._data;
      responseStatus = error.status;
      if (error.status < 500) {
        responseText = error.response.error.text;
      }
    } catch (e) { /* pass */ }

    err.requestUrl = requestUrl;
    err.resourceUrl = resourceUrl;
    err.requestData = requestData;
    err.responseText = responseText;
    err.responseStatus = responseStatus;

    return err;
  }

  //
  // Datastore methods
  //
  _find(query) {
    let willReject = false;
    let withReason;
    let params = query._params;

    let modelFromParam = (curModel, param) => {
      let willReject = false;
      let withReason;
      let model = param.model;
      if (model !== undefined) {
        if (!this._models[model]) {
          willReject = true;
          withReason = ERROR_UNKNOWN_MODEL.replace('${model}', model);

        }

      } else {
        let field = param.field;
        if (!this._models[curModel].links ||
            !this._models[curModel].links[field]) {
          willReject = true;
          withReason = ERROR_NO_LINKED_PROPERTY
                        .replace('${model}', curModel)
                        .replace('${property}', field);
        } else {
          model = this._models[curModel].links[field].model;
        }
      }

      return [willReject, withReason, model];
    };

    let queryModel;
    params.some((param) => {
      [
        willReject,
        withReason,
        queryModel
      ] = modelFromParam(queryModel, param);

      return willReject;
    });
    if (willReject) {
      return this._promise.reject(withReason);
    }

    let modelUrl = this._urlTemplateCache[queryModel];
    let requiredModels = modelUrl.split('|');
    modelUrl = requiredModels.shift();

    let rootFrom;
    queryModel = undefined;
    params.some((param) => {
      [
        willReject,
        withReason,
        queryModel
      ] = modelFromParam(queryModel, param);
      let id = param.id || '';

      if (!rootFrom && queryModel !== requiredModels[0]) {
        rootFrom = {
          id: id,
          model: queryModel
        };
      } else {
        modelUrl = modelUrl.replace(`:${queryModel}Id`, id);
      }
      requiredModels = requiredModels.filter((value) => {
        return value !== queryModel;
      });

      return id === '' || willReject;
    });

    if (requiredModels.length > 0 || rootFrom) {
      [
        willReject,
        withReason,
        modelUrl
      ] = this._rootModel(modelUrl, requiredModels, rootFrom);
    }

    if (willReject) {
      return this._promise.reject(withReason);
    }

    let urlParams = {};
    if ('_opts' in query && query._opts instanceof Object &&
        'fields' in query._opts && query._opts.fields instanceof Object) {
      Object.keys(query._opts.fields).forEach(function(type) {
        urlParams['fields[' + type + ']'] = query._opts.fields[type].join();
      });
    }

    return SuperAgent.get(this._absoluteUrl(modelUrl))
      .query(urlParams)
      .set(this._headers)
      .set('Content-Type', JSONAPI_MIME_TYPE)
      .then(this._transformResult.bind(this), (error) => {
        printDebug(error);

        let message = ERROR_CANNOT_FIND_OBJECT
                      .replace('${model}', queryModel);
        throw this._createError(message, modelUrl, error);
      });
  }

  _create(model, toCreate) {
    // transform the data before we send it to the server
    let postData = this._transformRequest(model, toCreate, true);
    let [
      willReject,
      withReason,
      modelUrl
    ] = this._rootNewModel(model, postData.data.id, postData.data);

    if (willReject) {
      return this._promise.reject(withReason);
    }

    return SuperAgent.post(this._absoluteUrl(modelUrl), postData)
      .set(this._headers)
      .set('Content-Type', JSONAPI_MIME_TYPE)
      .then(this._transformResult.bind(this), (error) => {
        printDebug(error);
        let message = ERROR_CANNOT_CREATE_OBJECT
                      .replace('${model}', model)
                      .replace('${modelState}', JSON.stringify(toCreate));
        throw this._createError(message, modelUrl, error);

      });
  }

  _update(model, toUpdate) {
    let [
      willReject,
      withReason,
      modelUrl
    ] = this._getUrlForModel(model, false, toUpdate);

    if (willReject) {
      return this._promise.reject(withReason);
    }

    let patchData = this._transformRequest(model, toUpdate, false);
    return SuperAgent.patch(this._absoluteUrl(modelUrl), patchData)
      .set(this._headers)
      .set('Content-Type', JSONAPI_MIME_TYPE)
      .then(this._transformResult.bind(this), (error) => {
        printDebug(error);
        let message = ERROR_CANNOT_UPDATE_OBJECT
                      .replace('${model}', model)
                      .replace('${modelState}', JSON.stringify(toUpdate));
        throw this._createError(message, modelUrl, error);
      });
  }

  _delete(model, toDelete) {
    let [
      willReject,
      withReason,
      modelUrl
    ] = this._getUrlForModel(model, false, toDelete);

    if (willReject) {
      return this._promise.reject(withReason);
    }

    return SuperAgent.del(this._absoluteUrl(modelUrl))
      .set(this._headers)
      .set('Content-Type', JSONAPI_MIME_TYPE)
      .then(null, (error) => {
        printDebug(error);
        let message = ERROR_CANNOT_DELETE_OBJECT
                      .replace('${model}', model)
                      .replace('${modelState}', JSON.stringify(toDelete));
        throw this._createError(message, modelUrl, error);
      });
  }

  /**
   * make the changes specified in the `patches`
   *
   * @param  {Array} patches - an array of patches whose path begins with `/${model}/${id}`
   * @return {Promise}       - a promise containing the results of the commit, only those items
   *                           that the server modified beyond what was specified in the patch
   *                           will be in the array passed to `resolve`. The contents of the
   *                           array will have the form:
   *                           {
   *                           	type: string
   *                           	oldId: uuid
   *                           	data: Object
   *                           }
   */
  _commit(patches) {
    let unrootedDiffs = this._parseObjects(patches);

    let diffTree = {};
    for (let i = 0; i < this._modelHierarchy.length; i++) {
      let model = this._modelHierarchy[i];
      if (!unrootedDiffs[model]) { continue; }

      if (Object.keys(unrootedDiffs[model]).length > 0) {
        diffTree[model] = {};
      }

      Object.keys(unrootedDiffs[model]).forEach((id) => {
        diffTree[model][id] = {
          diffs: unrootedDiffs[model][id]
        };
        delete unrootedDiffs[model][id];
      });

      this._rollUpDiffs(unrootedDiffs, model, diffTree[model]);

      // clean up models we've completely rooted
      Object.keys(unrootedDiffs).forEach((model) => {
        if (Object.keys(unrootedDiffs[model]).length === 0) {
          delete unrootedDiffs[model];
        }
      });
    }

    let rootedDiffs = this._rootDiffs(diffTree);

    return SuperAgent.patch(this._absoluteUrl('/'), rootedDiffs)
      .set(this._headers)
      .set('Accept', JSONPATCH_MIME_TYPE)
      .set('Content-Type', JSONPATCH_MIME_TYPE)
      .then((result) => {
        // responses are 200 (OK) or 204 (No content)
        // the patch extension returns an array of responses
        if (result.status !== 204) {
          let results = [];
          for (let i = 0; i < result.body.length; i++) {
            let jsonAPIdoc = result.body[i];
            let diff = rootedDiffs[i];
            if (jsonAPIdoc === null) { continue; }

            let data = this._transformResult({body: jsonAPIdoc});
            let oldId = diff.op === 'add' ? diff.value.id : undefined;
            let newId = data.id;

            this._setAlias(newId, oldId);

            results.push({
              type: jsonAPIdoc.data.type,
              oldId,
              data
            });
          }

          return results;
        }
      }, (error) => {
        printDebug(error);
        throw this._createError('Could not commit changes', '/', error);
      });
  }

  _addQueryParameter(key, value) {
    this._computedQueryParams = '';
    this._queryParameters[key] = value;
  }

  _addRequestHeader(key, value) {
    this._headers[key] = value;
  }

  _clearAuthData() {
    this._headers = {};
    this._queryParameters = {};
    this._computedQueryParams = '';
  }

  _dehydrate() {
    let aliasIds = JSON.stringify(this._aliasIds);
    let relationCache = JSON.stringify(this._relationCache);

    let headers = JSON.stringify(this._headers);
    let queryParameters = JSON.stringify(this._queryParameters);

    return {
      aliasIds,
      relationCache,
      headers,
      queryParameters
    };
  }

  _rehydrate(state) {
    let {
      aliasIds,
      relationCache,
      headers,
      queryParameters
    } = state;

    this._aliasIds = JSON.parse(aliasIds);
    this._relationCache = JSON.parse(relationCache);
    this._headers = JSON.parse(headers);
    this._queryParameters = JSON.parse(queryParameters);
  }
}

export default JsonApiDatastore;
