/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

/**
 * try to figure out if something could be a Promise
 * @param  {object}   promiseLike - the thing in question
 * @return {boolean}              - if it could be a promise
 */
export function objectLooksLikePromise(promiseLike) {
  if (!promiseLike) {
    return false;
  }

  // naïve check to see if a promise library is passed into options
  if (typeof promiseLike.all      !== 'function' ||
      typeof promiseLike.race     !== 'function' ||
      typeof promiseLike.resolve  !== 'function' ||
      typeof promiseLike.reject   !== 'function') {

    return false;
  }

  return true;
}
