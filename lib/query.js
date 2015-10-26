/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

class Query {
  /**
   * create a new query object
   * @param   {object}  storeInstance - the store this query is bound to
   * @param   {string}  model         - the model we are searching in
   * @param   {number}  id            - the id we are looking for (could be a uuid)
   * @param   {number}  opts          - additional arguments such as fields and includes
   */
  constructor(storeInstance, model, id, opts) {
    this._instance = storeInstance;
    this._params = [];
    this._params.push({
      model: model,
      id: id
    });
    this._opts = opts;
  }

  /**
   * add a new level of specificity to the query
   * @param   {string}  field - the linked field to continue searching down into
   * @param   {number}  id    - the id we are looking
   */
  find(field, id) {
    this._params.push({
      field: field,
      id: id
    });

    return this;
  }

  /**
   * execute the search and return the results
   * @return  {Promise}   the promise that will receive the results
   */
  then(success, failure) {
    return this._instance.find(this).then(success, failure);
  }
}

export default Query;
