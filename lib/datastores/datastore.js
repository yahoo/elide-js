/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

import debug from 'debug';
import Query from '../query';
import { objectLooksLikePromise } from '../helpers/checkpromise';

// jscs:disable maximumLineLength
export let ERROR_NO_PROMISE = 'Datastore must be initalized with a Promise.';
export let ERROR_BAD_TTL = 'Datastore ttl must be a Number or undefined.';
export let ERROR_NEG_TTL = 'Datastore ttl must be non-negative.';
export let ERROR_BAD_BASEURL = 'Datastore baseURL must be a String or undefined.';
export let ERROR_NO_MODELS = 'You must provide datastore with models.';
export let ERROR_NO_FIND = 'Datastore must implement _find in subclass.';
export let ERROR_NO_CREATE = 'Datastore must implement _create in subclass.';
export let ERROR_NO_UPDATE = 'Datastore must implement _update in subclass.';
export let ERROR_NO_DELETE = 'Datastore must implement _delete in subclass.';
export let ERROR_NO_COMMIT = 'Datastore must implement _commit in sublcass.';
export let ERROR_BAD_UPSTREAM = 'Only a Datastore can be upstream.';
export let ERROR_MUST_FIND_QUERY = 'Datastore#find did not receive a Query';
// jscs:enable maximumLineLength

let info = debug('elide:info');

/**
 * Base datastore class.
 */
class Datastore {
  /**
   * Datastore constructor
   *
   * @param       {Promise} Promise - a reference to the Promise function to be used by the instance
   * @param       {Number}  ttl     - the Number of milliseconds that we will cache data
   * @param       {String}  baseURL - the base URL to use when constructing queries to the API
   * @param       {Object}  models  - the description of the models
   */
  constructor(Promise, ttl, baseURL, models) {
    if (!objectLooksLikePromise(Promise)) {
      throw new Error(ERROR_NO_PROMISE);
    }

    if (ttl !== undefined && typeof ttl !== 'number') {
      throw new Error(ERROR_BAD_TTL);
    }
    if (ttl !== undefined && ttl < 0) {
      throw new Error(ERROR_NEG_TTL);
    }

    if (baseURL !== undefined && typeof baseURL !== 'string') {
      throw new Error(ERROR_BAD_BASEURL);
    }

    if (typeof models !== 'object') {
      throw new Error(ERROR_NO_MODELS);
    }

    this._promise = Promise;
    this._ttl = ttl;
    this._baseURL = baseURL;
    this._models = models;
  }

  /**
   * Find an object or set of objects. If they cannot be found in this store
   * and this store has an `upstream` store set then the search will continue
   * in the upstream store.
   *
   * @param   {Query}  query  - a query for us to resolve
   * @return  {Promise}       - a promise that will eventually receieve the results
   */
  find(query) {
    if (!(query instanceof Query)) {
      throw new Error(ERROR_MUST_FIND_QUERY);
    }

    return this._promise.reject('Not implemented');
  }

  /**
   * Create a new object and return it. The object can optionally be initalized
   * with state. The object will recieve a uuid for its `id` if the store is not
   * an interface for an upstream API.
   *
   * @param   {String}  model - the model that we'll be trying to find
   * @param   {Object}  state - the initial state of the object we're creating
   * @return  {Promise}       - a promise that will eventually receieve the results
   */
  create(model, state) {
    return this._promise.reject('Not implemented');
  }

  /**
   * Update an existing object.
   *
   * @param   {String}  model     - the model that we'll be trying to find
   * @param   {Object}  state     - the state of the object we're updating
   * @param   {Number}  state.id  - you must specify the `id` of the model to be updated
   * @return  {Promise}           - a promise that will eventually receieve the results
   */
  update(model, state) {
    return this._promise.reject('Not implemented');
  }

  /**
   * Delete an object from the datastore.
   *
   * @param   {String}  model     - the model that we'll be trying to find
   * @param   {Object}  state     - the state of the object we're deleting
   * @param   {Number}  state.id  - you must specify the `id` of the model to be deleted
   * @return  {Promise}           - a promise that will eventually receieve the results
   */
  delete(model, state) {
    return this._promise.reject('Not implemented');
  }

  /**
   * Push all pending operations to the upstream store.
   *
   * @param   {Array}   patches - the list of patches to apply to the store
   * @return  {Promise}         - a promise that receives the results of the operation
   */
  commit(patches) {
    return this._promise.reject('Not implemented');
  }

  /**
   * Specify a datastore that is upstream of this one. This is where data goes
   * when we call {@link Datastore#commit}
   *
   * @param   {Datastore} store - the store that is upstream of this store
   */
  setUpstream(store) {
    if (!(store instanceof Datastore)) {
      throw new Error(ERROR_BAD_UPSTREAM);
    }
    this._upstream = store;
  }

  /**
   * Add a query parameter to the store
   *
   * @param  {String}          key   - the name of the query parameter
   * @param  {String}          value - the value fo the query parameter
   */
  addQueryParameter(key, value) {}

  /**
   * Add a header to requests sent from this store
   *
   * @param  {String}         key   - the name of the header
   * @param  {String}         value - the value of the header
   */
  addRequestHeader(key, value) {}

  /**
   * clears the stored authentication data
   */
  clearAuthData() {}

  /**
   * seralizes any internal state for the store so that the store can
   * be reconstitued at a later time. (should be able to be stringify'ed)
   *
   * @return {Object} a seralized representation of the store
   */
  dehydrate() {
    if (typeof this._dehydrate === 'function') {
      return this._dehydrate();
    }
  }

  /**
   * deseralized the internal state of the store from the object produced by `dehydrate`
   *
   * @param  {Object} state - the representation of the store's state
   */
  rehydrate(state) {
    if (typeof this._rehydrate === 'function') {
      this._rehydrate(state);
    }
  }
}

export default Datastore;
