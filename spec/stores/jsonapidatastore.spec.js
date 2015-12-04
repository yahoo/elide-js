/*********************************************************************************
 * Copyright 2015 Yahoo Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and limitations
 * under the License.
*********************************************************************************/
/* jshint expr: true */
// jscs:disable maximumLineLength
'use strict';

var chai = require('chai');
chai.use(require('chai-as-promised'));
var expect = chai.expect;
var patch = require('fast-json-patch');
var uuid = require('uuid');

var JSONAPIDATASTORE = require('../../lib/datastores/jsonapidatastore');
var JsonApiDatastore = JSONAPIDATASTORE.default;
var ES6Promise       = require('es6-promise').Promise;
var Query            = require('../../lib/query');

describe('JsonApiDatastore', function() {
  var baseURL = 'http://localhost:1337/api';
  var simpleModels = {
    cat: {
      color: 'string',
      age: 'number',
      meta: {
        isRootObject: true
      },
      links: {}
    },
    dog: {
      breed: 'string',
      age: 'number',
      meta: {
        isRootObject: true
      },
      links: {}
    }
  };
  var modelsWithLinks = {
    person: {
      name: 'string',
      links: {
        pets: {
          model: 'pet',
          type: 'hasMany',
          inverse: 'owner'
        },
        bike: {
          model: 'bicycle',
          type: 'hasOne',
          inverse: 'owner'
        }
      },
      meta: {
        isRootObject: true
      }
    },
    bicycle: {
      maker: 'string',
      model: 'string',
      meta: {
        isRootObject: false
      },
      links: {}
    },
    pet: {
      type: 'string',
      name: 'string',
      age: 'number',
      links: {
        flees: {
          model: 'flee',
          type: 'hasMany'
        }
      },
      meta: {}
    },
    flee: {
      age: 'number',
      meta: {},
      links: {}
    }
  };

  var booksAndAuthorsURL = 'http://localhost:8882';
  var booksAndAuthorsModels = {
    book: {
      meta: {
        store: 'jsonapi',
        isRootObject: true
      },

      title: 'string',
      language: 'string',
      genre: 'string',

      links: {
        author: {
          model: 'author',
          type: 'hasMany',
          inverse: 'book'
        }
      }
    },
    author: {
      meta: {
        store: 'jsonapi',
        isRootObject: true
      },

      name: 'string',

      links: {}
    }
  };

  var booksAndAuthorsModelsNoGenre = {
    book: {
      meta: {
        store: 'jsonapi',
        isRootObject: true
      },

      title: 'string',
      language: 'string',

      links: {
        author: {
          model: 'author',
          type: 'hasMany',
          inverse: 'book'
        }
      }
    },
    author: {
      meta: {
        store: 'jsonapi',
        isRootObject: true
      },

      name: 'string',

      links: {}
    }
  };

  describe('initalize', function() {
    it('should initalize cleanly', function() {
      expect(function() {
        new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);
      }).not.to.throw();
    });
  });

  describe('#find', function() {
    var cat1 = {id: '1', color: 'black', age: 12};
    var cat2 = {id: '2', color: 'grey', age: 2};
    var cat3 = {id: '3', color: 'white', age: 5};
    var person1 = {id: '1', name: 'John', bike: null, pets: ['1', '2']};
    var pet1 = {id: '1', type: 'dog', name: 'spot', age: 4, owner: '1', flees: []};
    var pet2 = {id: '2', type: 'cat', name: 'blink', age: 2, owner: '1', flees: []};
    var flee1 = {id: '1', age: 12};
    var flee2 = {id: '2', age: 2};
    var book1 = {id: '1', genre: 'Literary Fiction', title: 'The Old Man and the Sea', author: []};
    var book2 = {id: '2', genre: 'Literary Fiction', title: 'For Whom the Bell Tolls', author: []};
    var book3 = {id: '3', genre: 'Science Fiction', title: 'Enders Game', author: []};

    it('should reject unknown models', function() {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, simpleModels);
      var q = new Query(store, 'catdog', 1);
      return expect(store.find(q))
              .to.eventually.be.rejectedWith(JSONAPIDATASTORE.ERROR_UNKNOWN_MODEL.replace('${model}', 'catdog'));
    });

    it('should fail if the resource does not exist', function() {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, simpleModels);

      var q = new Query(store, 'cat', 99);
      return expect(store.find(q))
              .to.eventually.be.rejected;
    });

    it('should be able to fetch a single root level model', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'person', 1);
      store.find(q).then(function(person) {
        expect(person.data).to.deep.equal(person1);
        done();
      }).catch(done);
    });

    it('should be able to fetch a single, fully rooted, nested model', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'person', 1).find('pets', 1);
      store.find(q).then(function(pet) {
        expect(pet.data).to.deep.equal(pet1);
        done();
      }).catch(done);
    });

    it('should be able to fetch a single nested model that it can root', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'person', 1);
      store.find(q).then(function(foundPerson) {
        expect(foundPerson.data).to.deep.equal(person1);

        var q = new Query(store, 'pet', 1);
        return store.find(q);

      }).then(function(foundPet) {
        expect(foundPet.data).to.deep.equal(pet1);

        done();
      }).catch(done);
    });

    it('should be able to fetch a collection of top level models', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, simpleModels);

      var q = new Query(store, 'cat');
      store.find(q).then(function(pets) {
        expect(pets.data).to.contain.deep.members([cat1, cat2, cat3]);
        done();
      }).catch(done);
    });

    it('should be able to fetch a collection of fully rooted nested models', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'person', 1).find('pets');
      store.find(q).then(function(pets) {
        expect(pets.data).to.contain.deep.members([pet1, pet2]);
        done();
      }).catch(done);
    });

    it('should be able to fetch a collection of nested models on a model it can root', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'person', 1);
      store.find(q).then(function(foundPerson) {
        var q = new Query(store, 'pet', 1).find('flees');
        return store.find(q);

      }).then(function(foundFlees) {
        expect(foundFlees.data).to.have.deep.members([flee1, flee2]);
        done();

      }).catch(done);
    });

    it('should reject a fetch for a collection of nested models it cannot root', function() {
      var store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);

      var q = new Query(store, 'pet', 1).find('flees');
      return expect(store.find(q))
              .to.eventually.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_ROOT_QUERY
                                              .replace('${model}', 'pet')
                                              .replace('${nextModel}', 'person')
                                              .replace('${id}', 1));
    });

    it('should only fetch title and genre and not language', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModels);

      var q = new Query(store, 'book', 1, {fields: {book: ['title', 'genre']}});
      store.find(q).then(function(result) {
        expect(result.data).to.not.have.property('language');
        expect(result.data).to.have.property('title');
        expect(result.data).to.have.property('genre');
        done();
      }).catch(done);
    });

    it('should only fetch title and language and not genre', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModelsNoGenre);

      var q = new Query(store, 'book', 1);
      store.find(q).then(function(result) {
        expect(result.data).to.not.have.property('genre');
        expect(result.data).to.have.property('title');
        expect(result.data).to.have.property('language');
        done();
      }).catch(done);
    });

    it('should only fetch literary fiction books', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModels);

      var q = new Query(store, 'book', undefined, {filters: {book: [ {attribute: 'genre', operator: "in", value: "Literary Fiction" }]}});
      store.find(q).then(function(result) {
        expect(result.data).to.deep.equal([book1, book2])
        done();
      }).catch(done);
    });

    it('should only fetch title and genre from all books', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModels);

      var q = new Query(store, 'book', undefined, {fields: {book: ['title', 'genre']}});
      store.find(q).then(function(books) {
        books.data.forEach(function(book) {
          expect(book).to.not.have.property('language');
          expect(book).to.have.property('genre');
          expect(book).to.have.property('title');
        });
        done();
      }).catch(done);
    });

    it('should only fetch enders game book', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModels);

      var q = new Query(store, 'book', undefined, {filters: {book: [ {attribute: 'title', operator: "in", value: "Enders Game"} ]}});
      store.find(q).then(function(result) {
        expect(result.data).to.deep.equal([book3]);
        done();
      }).catch(done);
    });

    it('should fetch books and authors', function(done) {
      var store = new JsonApiDatastore(ES6Promise, undefined, booksAndAuthorsURL, booksAndAuthorsModels);

      var q = new Query(store, 'book', undefined, {include: ['authors']});
      store.find(q).then(function(results) {
        var books = results['data'];
        var authorIds = [];
        var i;

        expect(books).to.be.not.empty;
        for (i = 0; i < books.length; i++) {
          authorIds.push(books[i]['id']);
          expect(books[i]).to.have.property('title');
        }

        var authors = results['included'];
        expect(authors).to.be.not.empty;
        for (i = 0; i < authors.length; i++) {
          expect(authorIds).to.have.property(authors[i].name)
        }
        done();
      }).catch(done);
    });
  });

  describe('#create', function() {
    var store;
    beforeEach(function() {
      store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);
    });

    it('should be able to create root level objects', function(done) {
      var person = {id: 1, name: 'John', bike: null, pets: []};
      store.create('person', {id: 'some-uuid', name: 'John'}).then(function(result) {
        expect(result.data).to.deep.equal(person);
        done();
      }).catch(done);
    });

    it('should be able to create nested objects', function(done) {
      var pet = {id: 1, name: 'spot', type: 'dog', age: null, owner: 1, flees: []};
      var q = new Query(store, 'person', 1);
      store.find(q).then(function(foundPerson) {
        return store.create('pet', {id: 'some-uuid', name: 'spot', type: 'dog', owner: 1});

      }).then(function(createdPet) {
        expect(createdPet.data).to.deep.equal(pet);
        done();

      }).catch(done);
    });

    it('should fail if it cannot root the query', function() {
      var flee = {id: 'some-uuid', age: 4};
      var apiObject = store._transformRequest('flee', flee);
      return expect(store.create('flee', flee))
        .to.eventually.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_ROOT_OBJECT
                                        .replace('${model}', 'flee')
                                        .replace('${modelState}', JSON.stringify(apiObject.data))
                                        .replace('${parentModel}', 'pet'));
    });

    it('should fail if the server responds with a 40x', function() {
      var failPerson = {id: 'some-uuid', name: 'FAIL'};
      return expect(store.create('person', failPerson))
        .to.eventually.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_CREATE_OBJECT
                                        .replace('${model}', 'person')
                                        .replace('${modelState}', JSON.stringify(failPerson)));
    });

  });

  describe('#update', function() {
    var store;
    beforeEach(function() {
      store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);
      var q = new Query(store, 'person', 1);
      return store.find(q);
    });

    it('should be able to update root objects', function(done) {
      var person = {id: 1, name: 'Cortana', bike: null, pets: [1, 2]};
      store.update('person', person).then(function(result) {
        expect(result.data).to.deep.equal(person);
        done();
      }).catch(done);
    });

    it('should be able to update nested objects', function(done) {
      var pet = {id: 1, name: 'rex', type: 'dog', owner: 1, age: null, flees: []};
      store.update('pet', pet).then(function(result) {
        expect(result.data).to.deep.equal(pet);
        done();
      }).catch(done);
    });

    it('should fail if it cannot root the object', function() {
      var flee = {id: 1, age: 4};
      return expect(store.update('flee', flee))
        .to.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_ROOT_OBJECT
                            .replace('${model}', 'flee')
                            .replace('${modelState}', JSON.stringify(flee))
                            .replace('${parentModel}', 'pet'));
    });

    it('should fail if the server rejects the update', function() {
      var person = {id: 4};
      return expect(store.update('person', person))
        .to.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_UPDATE_OBJECT
                            .replace('${model}', 'person')
                            .replace('${modelState}', JSON.stringify(person)));
    });

  });

  describe('#delete', function() {
    var store;
    beforeEach(function() {
      store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);
      var q = new Query(store, 'person', 1);
      return store.find(q);
    });

    it('should be able to delete root objects', function() {
      var person = {id: 1};
      return expect(store.delete('person', person))
        .to.be.fulfilled;
    });

    it('should be able to delete nested objects', function() {
      var pet = {id: 1, owner: 1};
      return expect(store.delete('pet', pet))
        .to.be.fulfilled;
    });

    it('should fail if it cannot root an object', function() {
      var pet = {id: 4};
      return expect(store.delete('pet', pet))
        .to.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_ROOT_OBJECT
                            .replace('${model}', 'pet')
                            .replace('${modelState}', JSON.stringify(pet))
                            .replace('${parentModel}', 'person'));
    });

    it('should fail if the server responds with a 40x', function() {
      var person = {id: 4};
      return expect(store.delete('person', person))
        .to.be.rejectedWith(JSONAPIDATASTORE.ERROR_CANNOT_DELETE_OBJECT
                            .replace('${model}', 'person')
                            .replace('${modelState}', JSON.stringify(person)));
    });

  });

  describe('#commit', function() {
    var store;
    var objects;
    var models;
    beforeEach(function() {
      store = new JsonApiDatastore(ES6Promise, undefined, baseURL, modelsWithLinks);
      models  = {
        person: {},
        pet: {},
        bicycle: {},
        flee: {}
      };
      objects = {
        person: {},
        pet: {},
        bicycle: {},
        flee: {}
      };
    });

    it('should have no return value when the server sends 204', function(done) {
      var id = uuid.v4();
      var johnId = id;
      objects.person[id] = {
        id: id,
        name: 'John',
        age: 37,
        bike: null,
        pets: []
      };
      id = uuid.v4();
      objects.person[id] = {
        id: id,
        name: 'Cortana',
        age: 4,
        bike: null,
        pets: []
      };

      id = uuid.v4();
      objects.bicycle[id] = {
        id: id,
        make: 'Trek',
        model: 'Mountain',
        owner: johnId
      };
      objects.person[johnId].bike = id;

      id = uuid.v4();
      objects.bicycle[id] = {
        id: id,
        make: 'Felt',
        model: 'SR-93',
        owner: 1
      };

      id = uuid.v4();
      var petId = id;
      objects.pet[id] = {
        id: id,
        type: 'dog',
        owner: johnId,
        flees: []
      };
      objects.person[johnId].pets.push(id);

      id = uuid.v4();
      objects.flee[id] = {
        id: id,
        age: 2
      };
      objects.pet[petId].flees.push(id);
      id = uuid.v4();
      objects.flee[id] = {
        id: id,
        age: 0
      };
      objects.pet[petId].flees.push(id);

      var q = new Query(store, 'person', 1);
      store.find(q).then(function(person) {
        return store.commit(patch.compare(models, objects));
      }).then(done).catch(done);
    });

    it('should return a model object when the server sends 200', function(done) {
      var id = uuid.v4();
      objects.person[id] = {
        id: id,
        name: 'John',
        age: 37,
        bike: null,
        pets: []
      };

      store.commit(patch.compare(models, objects)).then(function(objects) {
        expect(objects).to.deep.equal([
          {
            type: 'person',
            oldId: id,
            data: {
              id: '1',
              name: 'John',
              pets: ['1', '2'],
              bike: null
            }
          }
        ]);
        done();
      }).catch(done);
    });
  });

});
