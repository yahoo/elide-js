[![Build Status](https://travis-ci.org/yahoo/elide-js.svg?branch=master)](https://travis-ci.org/yahoo/elide-js)

Elide
===============
Elide is a library that makes it easy to talk to a [JSON API](http://jsonapi.org/format) compliant backend.
While it was specifically designed to talk to the [Elide server](https://github.com/yahoo/elide) it should
work with any server that is JSON API compliant.

While the examples make use of ES6, it is by no means required to write your code in ES6. Elide is developed
in ES6, but the distributed code is ES5 so you can run it without any other support libraries.

## Getting Started
```
npm install elide-js
```

Elide is tested on:
  * node 4.1.x
  * node 4.0.x
  * node 0.12.x
  * node 0.10.x

## Usage

  * [Schema](#Schema)
  * [API](#API)
    - [*constructor*](#constructor)
    - [find](#find)
    - [create](#create)
    - [update](#update)
    - [delete](#delete)
    - [beginTransaction](#beginTransaction)
    - [commitTransaction](#commitTransaction)
    - [rollbackTransaction](#rollbackTransaction)

### Schema
The schema is a javascript object composed of two sections: `stores` and `models`.

Example schema
```javascript
var SCHEMA = {
  stores: {
    memory: {
      type: 'memory', // memory stores cache data in the browser
      upstream: 'jsonapi', // upstream stores are where queries fall back to  
      ttl: 60000
    },
    jsonapi: {
      type: 'jsonapi', // jsonapi stores talk to remote servers to fetch data
      baseURL: 'https://stg6-large.flurry.gq1.yahoo.com/pulse/v1'
    }
  },
  models: {
    // all models have an implicit id property
    // only the properties that are listed directly in the object or in the links object
    // are parsed out of the response from server or sent to the server
    company: { // the property names in models are the name of the model (JSON API type)
      meta: {
        store: 'jsonapi', // where we should start looking for instances of this model
        isRootObject: true // if we can query for this model directly (defaults to false)
      },
      name: 'string',
      publisherLevel: 'string|number', // the values of the properties are meant as documentation,
                                       // in reality they could be any valid javascript value
      publisherDiscount: 'number',
      links: {
        project: {  // this key will be the property name in the parsed object
          model: 'project',  // what model type the property links to
          type: 'hasMany',   // hasOne|hasMany
          inverse: 'company' // what property on the other object will hold the inverse relationship
        }
      }
    },
    project: {
      meta: {
        store: 'memory'
      }
      name: 'string'
    }
  }
};

export default SCHEMA; // or module.exports = SCHEMA; if you prefer
```

### API
#### *constructor*(`schema`, `options`)
`schema` - an object as described in [schema](#Schema)

`options` - an object
`options.Promise` - Your favorite promise implementation
```javascript
var schema = require('./schema'); // import schema from './schema';
var Promise = require('es6-promise').Promise // import {Promise} from 'es6-promise';

var options = {
  Promise: Promise
};

var elide = new Elide(schema, options);
```
#### find(`model`, `id`) → Promise(`result`)
`model` - the name of the model (or property for nested queries) to search

`id` - (optional) the id to find (leave blank for collections)

`result` - the object (or array of objects) returned by the query
```javascript
elide.find('company', 1)
  .then((foundCompany) => {
    // do something with company 1
  }).catch((error) => {
    // inspect error to see what went wrong
  });

elide.find('company', 1)
  .find('projects')
  .then(function(projects) {
    // do something with company 1's projects
  }).catch(function(error) {
    // inspect error to see what went wrong
  });
```

#### create(`model`, `state`) → Promise(`result`)
`model` - The name of the model to be created

`state` - The initial state (without `id`) of the new object

`result` - The object created by `create`
```javascript
let company = {
  name: 'Flurry',
  publisherLevel: 'Advanced',
  publisherDiscount: 0.5
};
elide.create('company', company)
  .then((createdCompany) => {
    // company now has an id
  }).catch((error) => {
    // inspect error to see what went wrong
  });
```

#### update(`model`, `newState`) → Promise(`result`)
`model` - The name of the model to be updated

`state` - The new state of the object

`result` - The object updated by `update`
```javascript
let company = {
  id: 1,
  name: 'Flurry by Yahoo!'
};

elide.update('company', company)
  .then(function(updatedCompany) {
    // company.name now == 'Flurry by Yahoo!'
  }).catch(function(error) {
    // inspect error to see what went wrong
  });
```

#### delete(`model`, `state`) → Promise()
`model` - The name of the model to be deleted

`state` - An object that contains at least `id` with the id of the object to be deleted

Delete receives no value, but returns a Promise so errors can be caught.
```javascript
elide.delete('company', {id: 1})
  .then(function() {
    // there is no value received
  }).catch((error) => {
    // inspect error to see what went wrong
  });
```

#### beginTransaction() → Promise()
Lets stores know that a transaction is beginning.
```javascript
elide.beginTransaction()
  .then(function() {
    // do lots of awesome stuff in a batch
    // or mark the UI as ready for updates
  })
```

#### commitTransaction() → Promise()
Commit receives no value but returns a Promise so errors can be caught
```javascript
elide.commitTransaction()
  .then(() => {
    // there is no value received
  }).catch((error) => {
    // inspect error to see what went wrong
  });
```

#### rollbackTransaction() → Promise()
Lets stores know that the current transaction was cancelled
```javascript
elide.rollbackTransaction()
  .then(function() {
    // reset the UI (or preform the cancel button action)
  })
```
