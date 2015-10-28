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
var sinon = require('sinon');

var MEMORYDATASTORE = require('../../lib/datastores/memorydatastore');
var MemoryDatastore = MEMORYDATASTORE.default;
var ES6Promise      = require('es6-promise').Promise;
var Query           = require('../../lib/query');

var Datastore = require('../../lib/datastores/datastore').default;
var inherits   = require('inherits');

var NoopStore = function NoopStore(promise, ttl, url, models) {
  NoopStore.super_.call(this, promise, ttl, url, models);
};
inherits(NoopStore, Datastore);
NoopStore.prototype.commit = function(ops) {
  return new this._promise(function(resolve, reject) {
    resolve();
  });
};

var FakeStore = function FakeStore(promise, ttl, url, models) {
  FakeStore.super_.call(this, promise, ttl, url, models);
};
inherits(FakeStore, Datastore);
FakeStore.prototype.commit = function(ops) {
  return new this._promise(function(resolve, reject) {
    var cat = ops[0].value;
    var jsonDSReturn = {
      type: 'cat',
      oldId: cat.id,
      data: cat
    };
    jsonDSReturn.data.id = 1;
    resolve([
      jsonDSReturn
    ]);
  });
};

describe('MemoryDatastore', function() {
  var simpleModels = {
    cat: {
      color: 'string',
      age: 'number',
      links: {}
    },
    dog: {
      breed: 'string',
      age: 'number',
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
      }
    },
    bicycle: {
      maker: 'string',
      model: 'string',
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
      }
    },
    flee: {
      age: 'number',
      links: {}
    }
  };
  var personKeys = ['id', 'name', 'pets', 'bike'];
  var noopStore = new NoopStore(ES6Promise, undefined, undefined, simpleModels);
  var fakeStore = new FakeStore(ES6Promise, undefined, undefined, simpleModels);

  describe('initialization', function() {

    it('should initialize cleanly', function() {
      expect(function() {
        new MemoryDatastore(ES6Promise, 10, undefined, simpleModels);
      }).not.to.throw();
    });

    it('should use the correct promise lib', function() {
      var ms = new MemoryDatastore(ES6Promise, 10, undefined, simpleModels);
      var q = new Query(ms, 'cat', 1);
      expect(ms.find(q)).to.be.an.instanceof(ES6Promise);
    });

    it('should use the correct ttl', function() {
      var ms = new MemoryDatastore(ES6Promise, 10, undefined, simpleModels);
      expect(ms._ttl).to.equal(10);
    });
  });

  describe('subclassing', function() {
    var ms;
    var catId;

    before(function() {
      ms = new MemoryDatastore(ES6Promise, 10, undefined, simpleModels);
    });

    it('should implement find', function() {
      expect(ms.find(new Query(ms, 'cat', 1))).to.eventually.resolve;
    });

    it('should return a promise from find', function() {
      expect(ms.find(new Query(ms, 'cat', 1))).to.be.an.instanceof(ES6Promise);
    });

    it('should implement create', function(done) {
      ms.create('cat', {color: 'black'})
        .then(function(cat) {
          catId = cat.id;
          done();
        }, done);
    });

    it('should return a promise from create', function() {
      expect(ms.create('cat', {color: 'black'})).to.be.an.instanceof(ES6Promise);
    });

    it('should implement update', function() {
      expect(ms.update('cat', {id: catId, color: 'green'})).to.eventually.resolve;
    });

    it('should return a promise from update', function() {
      expect(ms.update('cat', {id: catId, color: 'green'})).to.be.an.instanceof(ES6Promise);
    });

    it('should implement delete', function() {
      expect(ms.delete('cat', {id: catId, color: 'green'})).to.eventually.resolve;
    });

    it('should return a promise from delete', function() {
      expect(ms.delete('cat', {id: catId, color: 'green'})).to.be.an.instanceof(ES6Promise);
    });

    it('should implement commit', function() {
      ms.setUpstream(fakeStore);
      expect(ms.commit()).to.eventually.resolve;
    });

    it('should return a promise from commit', function() {
      ms.setUpstream(fakeStore);
      expect(ms.commit()).to.be.an.instanceof(ES6Promise);
    });
  });

  describe('writing data', function() {
    var ms;

    before(function() {
      ms = new MemoryDatastore(ES6Promise, undefined, undefined, modelsWithLinks);
    });

    it('should be able to create new objects', function() {
      var person = {name: 'John'};
      return expect(ms.create('person', person)).to.eventually.have.all.keys(personKeys);
    });

    it('should ignore properties which are not part of the model on create', function() {
      var person = {name: 'John', occupation: 'Sierra 117'};
      return expect(ms.create('person', person)).to.eventually.have.all.keys(personKeys);
    });

    it('should reject creates with no data', function() {
      return expect(ms.create('person', null)).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_NO_STATE_GIVEN.replace('${method}', 'create'));
    });

    it('should not be able to create objects that specify an id', function() {
      var person = {name: 'John', id: 1};
      return expect(ms.create('person', person)).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_CANNOT_CREATE_WITH_ID);
    });

    it('should be able to modify objects', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.name = 'Master Chief';
        return ms.update('person', createdPerson);
      });
      return expect(promise).to.eventually.have.property('name', 'Master Chief');
    });

    it('should ignore properties which are not part of the model on modify', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.occupation = 'Master Chief';
        return ms.update('person', createdPerson);
      });
      return expect(promise).to.eventually.have.all.keys(personKeys);
    });

    it('should reject updates with no data', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        return ms.update('person', null);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_NO_STATE_GIVEN.replace('${method}', 'update'));
    });

    it('should reject updates that do not specify an id', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.id = undefined;
        return ms.update('person', createdPerson);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_CANNOT_UPDATE_WITHOUT_ID);
    });

    it('should not be able to modify objects which do not exist', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.id = 4;
        return ms.update('person', createdPerson);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_CANNOT_UPDATE_MISSING_RECORD.replace('${model}', 'person').replace('${method}', 'update'));
    });

    it('should be able to delete objects', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        return ms.delete('person', createdPerson);
      });
      return expect(promise).to.eventually.be.fulfilled;
    });

    it('should reject deletes with no data', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        return ms.delete('person', null);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_NO_STATE_GIVEN.replace('${method}', 'delete'));
    });

    it('should reject deletes that do not specify an id', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.id = undefined;
        return ms.delete('person', createdPerson);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_CANNOT_UPDATE_WITHOUT_ID);
    });

    it('should not be able to delete objects which do not exist', function() {
      var person = {name: 'John'};
      var promise = ms.create('person', person).then(function(createdPerson) {
        createdPerson.id = 4;
        return ms.delete('person', createdPerson);
      });
      return expect(promise).to.eventually.be.rejectedWith(MEMORYDATASTORE.ERROR_CANNOT_UPDATE_MISSING_RECORD.replace('${model}', 'person').replace('${method}', 'delete'));
    });
  });

  describe('maintaining relationships', function() {
    var ms;

    beforeEach(function() {
      ms = new MemoryDatastore(ES6Promise, undefined, undefined, modelsWithLinks);
    });

    it('should update to-one relationships when creating models', function(done) {
      var person = {name: 'John'};
      var bike1 = {maker: 'Felt', model: 'SR-73'};
      var bike2 = {maker: 'Felt', model: 'SR-73'};

      /**
       * - create bike1
       * - create person, person.bike = bike1.id
       * - find bike1, verify bike1.owner = person.id
       * - create bike2, bike2.owner = person.id
       * - find bike1, verify bike1.owner = undefined
       * - find person, verify person.bike = bike2.id
       */
      ms.create('bicycle', bike1).then(function(createdBike) {
        bike1 = createdBike;
        person.bike = createdBike.id;
        return ms.create('person', person);

      }).then(function(createdPerson) {
        person = createdPerson;

        var q = new Query(ms, 'bicycle', bike1.id);
        return ms.find(q);

      }).then(function(foundBike1) {
        expect(foundBike1.owner).to.equal(person.id);

        bike2.owner = person.id;
        return ms.create('bicycle', bike2);

      }).then(function(createdBike) {
        bike2 = createdBike;

        var q = new Query(ms, 'bicycle', bike1.id);
        return ms.find(q);

      }).then(function(foundBike1) {
        expect(foundBike1.owner).to.be.undefined;

        var q = new Query(ms, 'person', person.id);
        return ms.find(q);

      }).then(function(foundPerson) {
        expect(foundPerson.bike).to.equal(bike2.id);
        done();

      }).catch(done);
    });

    it('should not re-add relationships when updating models', function(done) {
      var john = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create john, with john.pets = [ spot.id ]
       * - find spot, expect spot.owner = john.id
       * - create blink, with blink.owner = john.id
       * - find john, expect john.pets = [ spot.id, blink.id ]
       */
      ms.create('pet', spot).then(function(pet) {
          spot = pet;
          john.pets = [spot.id];
          return ms.create('person', john);
        }).then(function(person1) {
          john = person1;
          blink.owner = john.id;
          return ms.create('pet', blink);
        }).then(function(pet) {
          blink = pet;
          john.name = 'Master Chief';
          return ms.update('person', {
            id: john.id,
            name: 'Master Chief'
          });
        }).then(function(person2) {
          john = person2;
          return ms.update('pet', {
            id: spot.id,
            name: 'Red'
          });
        }).then(function(pet) {
          return ms.find(new Query(ms, 'person', john.id));
        }).then(function(person3) {
          expect(person3, JSON.stringify(person3, null, 2) + ' != ' + JSON.stringify(john, null, 2)).to.deep.equal(john);
          done();
        }).catch(done);
    });

    it('should update to-many relationships when creating models', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create john, with john.pets = [ spot.id ]
       * - find spot, expect spot.owner = john.id
       * - create blink, with blink.owner = john.id
       * - find john, expect john.pets = [ spot.id, blink.id ]
       */
      ms.create('pet', spot).then(function(createdPet) {
        spot = createdPet;

        person.pets = [spot.id];
        return ms.create('person', person);

      }).then(function(createdPerson) {
        person = createdPerson;

        var q = new Query(ms, 'pet', spot.id);
        return ms.find(q);

      }).then(function(foundSpot) {
        expect(foundSpot.owner).to.equal(person.id);

        blink.owner = person.id;
        return ms.create('pet', blink);

      }).then(function(createdPet) {
        blink = createdPet;

        var q = new Query(ms, 'person', person.id);
        return ms.find(q);

      }).then(function(foundPerson) {
        expect(foundPerson.pets).to.have.members([spot.id, blink.id])
          .and.to.have.length(2);
        done();

      }).catch(done);
    });

    it('should reject creates that link to non-existant objects', function(done) {
      var person = {name: 'John', bike: 1};
      ms.create('person', person).then(function() {
        done('should not create person');

      }, function(error) {
        expect(error.message).to.be.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                  .replace('${model}', 'bicycle')
                                  .replace('${id}', '1')
                                  .replace('${method}', 'create'));

        person.bike = undefined;
        person.pets = [1];
        ms.create('person', person).then(function() {
          done('still should not create person');

        }, function(error) {
          expect(error.message).to.be.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                    .replace('${model}', 'pet')
                                    .replace('${id}', '1')
                                    .replace('${method}', 'create'));
          done();
        }).catch(done);
      }).catch(done);
    });

    it('should retain correct relationships when creates fail', function(done) {
      // this test is fragile, since it is dependent on the order in which
      // the processes the model's properties

      var person = {name: 'John', bike: 1};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create blink
       * - try to create john (which should fail)
       * - fetch spot, verify that spot.owner is not set
       * - fetch blink, verify that blink.owner is not set
       */
      ms.create('pet', spot).then(function(createdPet) {
        spot = createdPet;

        return ms.create('pet', blink);
      }).then(function(createdPet) {
        blink = createdPet;
        person.pets = [spot.id, blink.id];

        return ms.create('person', person);

      }).then(function(createdPerson) {
        done('We should not have been able to create a person!');

      }, function(error) {
        var q = new Query(ms, 'pet', spot.id);
        return ms.find(q);

      }).then(function(foundPet) {
        expect(foundPet.owner).to.be.undefined;

        var q = new Query(ms, 'pet', blink.id);
        return ms.find(q);

      }).then(function(foundPet) {
        expect(foundPet.owner).to.be.undefined;
        done();

      }).catch(done);

    });

    it('should update to-one relationships when updating objects', function(done) {
      var person = {name: 'John'};
      var bike1 = {maker: 'Felt', model: 'SR-73'};
      var bike2 = {maker: 'Felt', model: 'SR-73'};

      /**
       * - create bike1
       * - create bike2
       * - create person
       * - update person.bike = bike1.id
       * - verify person.bike = bike1.id, find bike1
       * - verify bike1.owner = person.id, update bike2.owner = person.id
       * - verify bike2.owner = person.id, find person
       * - verify person.bike = bike2.id, find bike1
       * - verify bike1.owner = undefined
       */
      ms.create('bicycle', bike1).then(function(createdBike) {
        bike1 = createdBike;

        return ms.create('bicycle', bike2);

      }).then(function(createdBike) {
        bike2 = createdBike;

        return ms.create('person', person);

      }).then(function(createdPerson) {
        person = createdPerson;

        person.bike = bike1.id;
        return ms.update('person', person);

      }).then(function(updatedPerson) {
        expect(updatedPerson.bike).to.equal(bike1.id);

        var q = new Query(ms, 'bicycle', bike1.id);
        return ms.find(q);

      }).then(function(foundBike) {
        expect(foundBike.owner).to.equal(person.id);

        bike2.owner = person.id;
        return ms.update('bicycle', bike2);

      }).then(function(updatedBike) {
        expect(updatedBike.owner).to.equal(person.id);

        var q = new Query(ms, 'person', person.id);
        return ms.find(q);

      }).then(function(foundPerson) {
        expect(foundPerson.bike).to.equal(bike2.id);

        var q = new Query(ms, 'bicycle', bike1.id);
        return ms.find(q);

      }).then(function(foundBike) {
        expect(foundBike.owner).to.be.undefined;
        done();

      }).catch(done);

    });

    it('should update to-many relationships when updating objects', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create blink
       * - create person, set person.pets = [blink.id]
       * - verify person.pets = [blink.id], find blink
       * - verify blink.owner = perons.id, set spot.owner = person.id
       * - verify spot.owner = perons.id, find person
       * - verify person.pets = [blink.id, spot.id]
       */
      ms.create('pet', spot).then(function(createdPet) {
         spot = createdPet;
         return ms.create('pet', blink);

       }).then(function(createdPet) {
         blink = createdPet;
         return ms.create('person', person);

       }).then(function(createdPerson) {
         person = createdPerson;
         person.pets = [blink.id];
         return ms.update('person', person);

       }).then(function(updatedPerson) {
         expect(updatedPerson.pets).to.have.members([blink.id])
          .and.to.have.length(1);

         var q = new Query(ms, 'pet', blink.id);
         return ms.find(q);

       }).then(function(foundPet) {
         expect(foundPet.owner).to.equal(person.id);

         spot.owner = person.id;
         return ms.update('pet', spot);

       }).then(function(foundPet) {
         expect(foundPet.owner).to.equal(person.id);

         var q = new Query(ms, 'person', person.id);
         return ms.find(q);

       }).then(function(foundPerson) {
         expect(foundPerson.pets).to.have.members([blink.id, spot.id])
          .and.to.have.length(2);
         done();

       }).catch(done);
    });

    it('should reject updates that link to non-existant objects', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create blink
       * - create person, set person.pets = [blink.id, 1]
       * - expect rejection
       * - update bike.owner = 1
       */
      ms.create('pet', spot).then(function(createdPet) {
        spot = createdPet;
        return ms.create('pet', blink);

      }).then(function(createdPet) {
        blink = createdPet;
        person.pets = [blink.id];
        return ms.create('person', person);

      }).then(function(createdPerson) {
        person = createdPerson;
        expect(createdPerson.pets).to.have.members([blink.id])
          .and.to.have.length(1);

        person.pets = [spot.id, 1];
        return ms.update('person', person);

      }).then(function(updatedPerson) {
        done('should not have updated person');

      }, function(error) {
        expect(error.message).to.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                .replace('${model}', 'pet')
                                .replace('${id}', '1')
                                .replace('${method}', 'update'));

      }).then(function() {
        person.pets = [spot.id];
        person.bike = 1;
        return ms.update('person', person);

      }).then(function() {
        done('should not have updated person');

      }, function(error) {
        expect(error.message).to.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                .replace('${model}', 'bicycle')
                                .replace('${id}', '1')
                                .replace('${method}', 'update'));
        done();
      }).catch(done);
    });

    it('should retain correct relationships when updates fail', function(done) {
      var person = {name: 'John'};
      var bike = {maker: 'Felt', model: 'SR-73'};
      var spot = {name: 'Spot', type: 'dog'};
      var blink = {name: 'Blink', type: 'cat'};

      /**
       * - create spot
       * - create blink
       * - create bike
       * - create person, person.pets = [blink.id]
       * - update person.pets = [spot.id, 1], person.bike = bike.id
       * - expect rejection
       * - find person
       * - expect person.pets == [blink.id] and person.bike == undefined,
       * 		update person.pets = [spot.id] person.bike = 1
       * - expect rejection
       * - find person
       * - expect person.pets == [blink.id] berson.bike == undefined
       */
      ms.create('pet', spot).then(function(createdPet) {
        spot = createdPet;
        return ms.create('pet', blink);

      }).then(function(createdPet) {
        blink = createdPet;
        return ms.create('person', person);

      }).then(function(createdPerson) {
        person = createdPerson;
        person.pets = [blink.id];
        return ms.update('person', person);

      }).then(function(updatedPerson) {
        expect(updatedPerson.pets).to.have.members([blink.id])
          .and.to.have.length(1);

        person.bike = bike.id;
        person.pets = [spot.id, 1];
        return ms.update('person', person);

      }).then(function(updatedPerson) {
        done('should not have updated person');

      }, function(error) {
        expect(error.message).to.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                .replace('${model}', 'pet')
                                .replace('${id}', '1')
                                .replace('${method}', 'update'));

      }).then(function() {
         var q = new Query(ms, 'person', person.id);
         return ms.find(q);

       }).then(function(foundPerson) {
         expect(foundPerson.bike).to.be.undefined;
         expect(foundPerson.pets).to.have.members([blink.id])
           .and.to.have.length(1);

         person.pets = [spot.id];
         person.bike = 1;
         return ms.update('person', person);

       }).then(function() {
         done('should not have updated person');

       }, function(error) {
        expect(error.message).to.equal(MEMORYDATASTORE.ERROR_CANNOT_LINK_TO_MISSING_RECORD
                                .replace('${model}', 'bicycle')
                                .replace('${id}', '1')
                                .replace('${method}', 'update'));
      }).then(function() {
        var q = new Query(ms, 'person', person.id);
        return ms.find(q);

      }).then(function(foundPerson) {
        expect(foundPerson.pets).to.have.members([blink.id])
          .and.to.have.length(1);

        done();
      }).catch(done);
    });
  });

  describe('reading data', function() {
    var ms;

    beforeEach(function() {
      ms = new MemoryDatastore(ES6Promise, undefined, undefined, modelsWithLinks);
    });

    it('should return top level results', function(done) {
      var person = {name: 'John'};

      ms.create('person', person).then(function(createdPerson) {
        person = createdPerson;
        var q = new Query(ms, 'person', createdPerson.id);
        return ms.find(q);

      }).then(function(foundPerson) {
        expect(foundPerson).to.deep.equal(person);
        done();

      }).catch(done);
    });

    it('should traverse relationships and return linked results', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog', age: 2};

      ms.create('person', person).then(function(createdPerson) {
        person = createdPerson;
        spot.owner = person.id;
        return ms.create('pet', spot);

      }).then(function(createdPet) {
        spot = createdPet;
        var q = new Query(ms, 'person', person.id).find('pets', spot.id);
        return ms.find(q);

      }).then(function(foundSpot) {
        expect(foundSpot).to.deep.equal(spot);
        done();

      }).catch(done);
    });

    it('should return top level collections', function(done) {
      var bike1 = {maker: 'Felt', model: 'SR-73'};
      var bike2 = {maker: 'Felt', model: 'SR-73'};

      /**
       * - create bike1
       * - create bike2
       * - find all bikes
       */
      ms.create('bicycle', bike1).then(function(createdBike) {
        bike1 = createdBike;

        return ms.create('bicycle', bike2);

      }).then(function(createdBike) {
        bike2 = createdBike;

        var q = new Query(ms, 'bicycle');
        return ms.find(q);

      }).then(function(foundBikes) {
        expect(foundBikes).to.have.length(2)
          .and.deep.members([bike1, bike2]);

        done();
      }).catch(done);
    });

    it('should return nested collections', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog', age: 2};
      var blink = {name: 'Blink', type: 'cat', age: 1};
      var dory = {name: 'Dory', type: 'fish', age: 3.5};

      /**
       * - create person
       * - create spot
       * - create blink
       * - find all pets for person
       */
      ms.create('person', person).then(function(createdPerson) {
        person = createdPerson;

        spot.owner = person.id;
        return ms.create('pet', spot);

      }).then(function(createdPet) {
        spot = createdPet;

        blink.owner = person.id;
        return ms.create('pet', blink);

      }).then(function(createdPet) {
        blink = createdPet;

        return ms.create('pet', dory);

      }).then(function(createdPet) {
        var q = new Query(ms, 'person', person.id).find('pets');
        return ms.find(q);

      }).then(function(foundPets) {
        expect(foundPets).to.have.length(2)
          .and.to.have.deep.members([spot, blink]);

        done();
      }).catch(done);
    });

    it('should return collections nested in collections', function(done) {
      var john = {name: 'John'};
      var cortana = {name: 'Cortana'};

      var spot = {name: 'Spot', type: 'dog', age: 2};
      var blink = {name: 'Blink', type: 'cat', age: 1};
      var dory = {name: 'Dory', type: 'fish', age: 3.5};

      /**
       * - create john
       * - create spot
       * - create blink
       * - create cortana
       * - create dory
       * - create betsy (who shoudn't be returned in the next query)
       * - find all pets for all people
       */
      ms.create('person', john).then(function(createdPerson) {
        john = createdPerson;

        spot.owner = john.id;
        return ms.create('pet', spot);

      }).then(function(createdPet) {
        spot = createdPet;

        blink.owner = john.id;
        return ms.create('pet', blink);

      }).then(function(createdPet) {
        blink = createdPet;

        return ms.create('person', cortana);

      }).then(function(createdPerson) {
        cortana = createdPerson;

        dory.owner = cortana.id;
        return ms.create('pet', dory);

      }).then(function(createdPet) {
        dory = createdPet;

        return ms.create('pet', {name: 'Betsy', type: 'cow', age: 9});

      }).then(function(createdPet) {

        var q = new Query(ms, 'person').find('pets');
        return ms.find(q);

      }).then(function(foundPets) {
        expect(foundPets).to.have.length(3)
          .and.to.have.deep.members([spot, blink, dory]);

        done();
      }).catch(done);
    });

    it('should not return results which exist but are not linked', function(done) {
      var person = {name: 'John'};
      var spot = {name: 'Spot', type: 'dog', age: 2};

      /**
       * - create a person
       * - create spot, ask for spot linked to the person
       * - verify he can't be found, ask for all the person's pets
       * - verify that there aren't any, ask for all pets of all people
       * - verify that there aren't any, ask for spot as linked from anyone
       */
      ms.create('person', person).then(function(createdPerson) {
        person = createdPerson;

        return ms.create('pet', spot);

      }).then(function(createdPet) {
        spot = createdPet;

        var q = (new Query(ms, 'person', person.id)).find('pets', spot.id);
        return ms.find(q);

      }).then(function(foundPet) {
        expect(foundPet).to.be.undefined;

        var q = (new Query(ms, 'person', person.id)).find('pets');
        return ms.find(q);

      }).then(function(foundPets) {
        expect(foundPets).to.have.length(0);

        var q = (new Query(ms, 'person')).find('pets');
        return ms.find(q);

      }).then(function(foundPets) {
        expect(foundPets).to.have.length(0);

        var q = (new Query(ms, 'person')).find('pets', spot.id);
        return ms.find(q);

      }).then(function(foundPet) {
        expect(foundPet).to.be.undefined;

        done();
      }).catch(done);
    });

    it('should not try to traverse properties which are not links', function(done) {
      var person = {name: 'John'};

      ms.create('person', person).then(function(createdPerson) {
        person = createdPerson;

        var q = new Query(ms, 'person', createdPerson.id).find('name', 12);
        return ms.find(q);

      }).then(function() {
        done('we should not be able to find via `person.name`.');

      }, function(error) {
        expect(error.message).to.be.equal(MEMORYDATASTORE.ERROR_CANNOT_FIND_ON_PROP
                                  .replace('${model}', 'person')
                                  .replace('${property}', 'name'));
        done();

      }).catch(done);
    });
  });

  describe('models', function() {
    var ms;

    beforeEach(function() {
      ms = new MemoryDatastore(ES6Promise, undefined, undefined, modelsWithLinks);
    });

    it('should allow known models', function() {
      var q1 = new Query(ms, 'pet', 1);
      var q2 = new Query(ms, 'person', 1);

      expect(function() {
        ms.find(q1);
        ms.find(q2);
      }).not.to.throw();

      ['create', 'update', 'delete'].forEach(function(method) {

        expect(function() {
          ms[method]('pet', {});
          ms[method]('person', {});
        }).not.to.throw();
      });
    });

    it('should NOT allow unknown models', function() {
      var q = new Query(ms, 'catdog', 1);
      expect(function() {
        ms.find(q);
      }).to.throw(MEMORYDATASTORE.ERROR_UNKNOWN_MODEL.replace('${model}', 'catdog').replace('${method}', 'find'));

      ['create', 'update', 'delete'].forEach(function(method) {
        expect(function() {
          ms[method]('catdog', {id: 1});
        }).to.throw(MEMORYDATASTORE.ERROR_UNKNOWN_MODEL.replace('${model}', 'catdog').replace('${method}', method));
      });
    });
  });

  describe('upstream', function() {

    it('should read from upstream after ttl', function(done) {
      var ms1 = new MemoryDatastore(ES6Promise, 10, undefined, simpleModels);
      var ms2 = new MemoryDatastore(ES6Promise, undefined, undefined, simpleModels);
      ms1.setUpstream(ms2);
      sinon.spy(ms2, 'find');

      var cat = {color: 'black', age: 2};
      ms2.create('cat', cat).then(function(createdCat) {
        cat = createdCat;

      }).then(function() {
        var q = new Query(ms1, 'cat', cat.id);
        return ms1.find(q);

      }).then(function(foundCat) {
        expect(foundCat).to.deep.equal(cat);

        var q = new Query(ms1, 'cat', cat.id);
        return new ES6Promise(function(resolve, reject) {
          setTimeout(function() {
            ms1.find(q).then(resolve);
          }, 250);
        });

      }).then(function(foundCat) {
        expect(foundCat).to.deep.equal(cat);
        expect(ms2.find.callCount).to.equal(2);

        done();
      }).catch(done);
    });

    it('should read from upstream if it does not have data locally', function(done) {
      var ms1 = new MemoryDatastore(ES6Promise, undefined, undefined, simpleModels);
      var ms2 = new MemoryDatastore(ES6Promise, undefined, undefined, simpleModels);
      ms1.setUpstream(ms2);
      sinon.spy(ms2, 'find');

      var cat = {color: 'black', age: 2};
      ms2.create('cat', cat).then(function(createdCat) {
        cat = createdCat;

      }).then(function() {
        var q = new Query(ms1, 'cat', cat.id);
        return ms1.find(q);

      }).then(function(foundCat) {
        expect(foundCat).to.deep.equal(cat);

        var q = new Query(ms1, 'cat', cat.id);
        return ms1.find(q);

      }).then(function(foundCat) {
        expect(foundCat).to.deep.equal(cat);
        expect(ms2.find.callCount).to.equal(1);

        done();
      }).catch(done);
    });

    it('should send diffs upstream', function(done) {
      var ms1 = new MemoryDatastore(ES6Promise, undefined, undefined, simpleModels);
      ms1.setUpstream(noopStore);
      sinon.spy(noopStore, 'commit');

      var cat = {color: 'black', age: 2};
      ms1.create('cat', cat).then(function(createdCat) {
        cat = createdCat;
        return ms1.commit();

      }).then(function() {
        var op = {
          op: 'add',
          path: '/cat/' + cat.id,
          value: cat
        };
        expect(noopStore.commit.lastCall.args[0], 'create')
          .to.have.deep.members([op])
          .and.to.have.length(1);

        cat.color = 'grey';
        return ms1.update('cat', cat);

      }).then(function(updatedCat) {
        cat = updatedCat;
        return ms1.commit();

      }).then(function() {
        var op = {
          op: 'replace',
          path: '/cat/' + cat.id + '/color',
          value: 'grey'
        };
        expect(noopStore.commit.lastCall.args[0], 'update')
          .to.have.deep.members([op])
          .and.to.have.length(1);

      }).then(function() {
        return ms1.delete('cat', cat);

      }).then(function() {
        return ms1.commit();

      }).then(function() {
        var op = {
          op: 'remove',
          path: '/cat/' + cat.id
        };
        expect(noopStore.commit.lastCall.args[0], 'delete (' + JSON.stringify(noopStore.commit.lastCall.args[0]) + ')')
          .to.have.deep.members([op])
          .and.to.have.length(1);

        done();
      }).catch(done);
    });

    it('should update uuids to actual ids', function(done) {
      var ms1 = new MemoryDatastore(ES6Promise, undefined, undefined, simpleModels);
      ms1.setUpstream(fakeStore);

      var cat = {color: 'blue', age: 3};
      ms1.create('cat', cat).then(function(createdCat) {
        cat = createdCat;
        return ms1.commit();

      }).then(function() {
        var q = new Query(ms1, 'cat', cat.id);
        return ms1.find(q);

      }).then(function(foundCat) {
        cat.id = 1;
        expect(foundCat).to.deep.equal(cat);
        var q = new Query(ms1, 'cat', cat.id);
        return ms1.find(q);

      }).then(function(foundCat) {
        expect(foundCat).to.deep.equal(cat);

        done();
      }).catch(done);
    });

    it('should fail if it receives a bad response from upstream');
  });
});
