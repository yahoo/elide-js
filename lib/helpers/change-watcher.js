/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 ********************************************************************************/
'use strict';

import jsonpatch from 'fast-json-patch';

class ChangeWatcher {
  constructor() {
    this.watchers = [];
  }

  watchModel(object, model) {
    if (!object) {
      return;
    }

    this.watchers.push({
      observer: jsonpatch.observe(object),
      path: `/${model}/${object.id}`
    });
  }

  getPatches() {
    let patches = [];

    for (let i = 0; i < this.watchers.length; i++) {
      let path = this.watchers[i].path;
      let observer = this.watchers[i].observer;

      let partials = jsonpatch.generate(observer);
      for (let j = 0; j < partials.length; j++) {
        partials[j].path = `${path}${partials[j].path}`;
      }

      patches = patches.concat(partials);
    }

    return patches;
  }
}

export default ChangeWatcher;
