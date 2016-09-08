/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

class Query {
  /**
   * create a new query object
   *
   * @param   {object}  storeInstance - the store this query is bound to
   * @param   {string}  model         - the model we are searching in
   * @param   {number}  id            - the id we are looking for (could be a uuid)
   * @param   {number}  options       - additional arguments such as fields and includes
   */
  constructor(storeInstance, model, id, options) {
    this._instance = storeInstance;
    this._params = [];
    this._params.push({
      model: model,
      id: id
    });

    options = options || {};
    options.fields = options.fields || {};
    options.filters = options.filters || {};
    options.include = options.include || [];
    this._opts = options;
  }

  /**
   * add a new level of specificity to the query
   *
   * @param   {string}  field   - the linked field to continue searching down into
   * @param   {number}  id      - the id we are looking
   * @param   {object}  options - some options for the query
   */
  find(field, id, options) {
    if (id instanceof Object) {
      options = id;
      id = undefined;
    }

    this._params.push({
      field: field,
      id: id
    });
    this._mergeOptions(options || {});

    return this;
  }

  /**
   * merge the options object with this._opts
   *
   * @param  {object} options - the additional options provided
   */
  _mergeOptions(options) {
    if (options.fields) {
      Object.keys(options.fields).forEach((model) => {
        this._opts.fields[model] =
          (this._opts.fields[model] || []).concat(options.fields[model]);
      });
    }

    if (options.filters) {
      Object.keys(options.filters).forEach((model) => {
        this._opts.filters[model] =
          (this._opts.filters[model] || []).concat(options.filters[model]);
      });
    }

    if (options.include) {
      this._opts.include.push.apply(this._opts.include, options.include);
    }
  }

  /**
   * execute the search and return the results
   *
   * @return  {Promise}   the promise that will receive the results
   */
  then(success, failure) {
    return this._instance.find(this).then(success, failure);
  }
}

export default Query;
