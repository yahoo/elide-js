/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

export default function clone(object) {
  let copy;

  if (typeof object !== 'object' || object === null) {
    return object;
  }

  if (object instanceof Date) {
    copy = new Date(object.getTime());

  } else if (object instanceof Array) {
    copy = object.map((el) => { return clone(el); });

  } else {
    copy = Object.create(object.prototype || {});
    Object.keys(object).forEach((key) => { copy[key] = clone(object[key]); });
  }

  return copy;
}
