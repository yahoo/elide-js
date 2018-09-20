**Please Note:** This repository has known security vulnerabilities. Use at your own risk!

[![Stories in Ready](https://badge.waffle.io/yahoo/elide-js.png?label=ready&title=Ready)](https://waffle.io/yahoo/elide-js)
[![Build Status](https://travis-ci.org/yahoo/elide-js.svg?branch=master)](https://travis-ci.org/yahoo/elide-js) [![npm version](https://badge.fury.io/js/elide-js.svg)](https://badge.fury.io/js/elide-js) [![Code Climate](https://codeclimate.com/github/yahoo/elide-js/badges/gpa.svg)](https://codeclimate.com/github/yahoo/elide-js)

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
    - [commit](#commit)

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
`options.promise` - Your favorite promise implementation
```javascript
var schema = require('./schema'); // import schema from './schema';
var Promise = require('es6-promise').Promise // import {Promise} from 'es6-promise';

var options = {
  promise: Promise
};

var elide = new Elide(schema, options);
```
#### find(`model`, `id`, `opts`) → Promise(`result`)
`model` - the name of the model (or property for nested queries) to search

`id` - (optional) the id to find (leave blank for collections)

`opts` - (optional) additional options for querying sparse fields, filtering and includes (see below)

`result` - the object returned by the query. Will have the format: 
```
{
  data: object|array, 
  included: {
    model: [], 
    model2: []
  }
}```

```javascript
elide.find('company', 1)
  .then((results) => {
    // do something with company 1
  }).catch((error) => {
    // inspect error to see what went wrong
  });

elide.find('company', 1)
  .find('projects')
  .then(function(results) {
    // do something with company 1's projects
  }).catch(function(error) {
    // inspect error to see what went wrong
  });
  
elide.find('company', 1, {fields: {projects: ['name', 'companyid']}})
  .find('projects')
    .then(function(results) {
      // do something with company 1's projects's name and company id
    }).catch(function(error) {
      // inspect error to see what went wrong
    });

elide.find('company', 1, {filters: {project: [ {attribute: 'name', operator: "in", value: "myapp" }]}})
  .find('projects')
    .then(function(results) {
      // do something with company 1's only myapp projects
    }).catch(function(error) {
      // inspect error to see what went wrong
    });
```

##### Options

`include` - an array of additional resource objects to include in the results that are 
related to the primary data. The contents of the array are the property names of the 
relationships. For example `['authors', 'authors.spouse', 'publisher.bankAccounts']` 
would include the authors for the requested books, the spouses for the included authors, 
and the bank accounts for the publisher of the requested books.

For instance, you might query for books and include the related author resources as follows:

```javascript
elide.find('book', {include: ['authors']})
  .then((results) => {
    console.log(results.data); // the books
    console.log(results.included); // the included resources (authors)
  });
```

`fields` - an object that specifies which set of fields to return for each model.
By default, all attributes and relationships described in the model will be fetched.

For instance, query for the title and authors of books as follows:

```javascript
elide.find('book', {fields: {book: ['title', 'authors']}})
  .then((results) => {
    console.log(results.data); // only book information will be available
  });
```

**Note:** If you specify a fields option, it overrides the fields for **all models**.
What this means is that if you query for books, include authors and ask for title and 
authors of books, you will not get any fields back for authors. In addition to
title and authors of books, you will also have to include name of authors, as follows:

```javascript
elide.find('book', {include: ['authors'], fields: {book: ['title', 'authors'], author: ['name']}})
  .then((results) => {
    console.log(results.data); // only book.title and book.authors will be available
    console.log(results.included); // only author.name will be available
  });
```

`filters` - an object that specifies criteria that result types must match.

For instance, query for all books that start with Harry Potter as follows:

```javascript
elide.find('book', {filters: {book: [ {attribute: 'title', operator: "prefix", value: "Harry Potter"} ]})
  .then((results) => {
    console.log(results.data); // returns books with title Harry Potter
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

#### commit() → Promise()
Commit receives no value but returns a Promise so errors can be caught
```javascript
elide.commit()
  .then(() => {
    // there is no value received
  }).catch((error) => {
    // inspect error to see what went wrong
  });
```
