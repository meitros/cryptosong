/**
 * Tag Model module.
 * @module models/tag
 */
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const Fawn = require('fawn');
const SongModel = require('./song');

const songSchema = new Schema({
  _id: Schema.Types.ObjectId,
  number: Number,
  title: String,
  date: Date,
  length: Number,
  inkey: { type: Schema.Types.ObjectId, ref: 'Inkey' },
  tempo: Number,
  videoid: String,
  description: String,
  acousticproduced: String,
  itunes: String,
  spotify: String,
  bandcamp: String,
  mood: String,
  // tags: [Models.Tag.tagSchema],
});

const tagSchema = new Schema({
  image: String,
  name: String,
  songs: [songSchema],
});

const Tag = mongoose.model('Tag', tagSchema);

const cleanObj = (obj) => {
  obj = obj.toObject();
  for (let key in obj) {
    if (obj[key] === undefined || obj[key] === null) {
      delete obj[key]
    }
  }
  return obj;
}
/**
* This method returns a tag document populated with tag's associated songs.
* @param {string} name - A string representing the name of the requested tag.
* @return {promise} the promise resolves with the matching tag document along with all the songs in the tag's subdocument array.
*/
module.exports.getSongsForTag = (name) => {
  return new Promise((resolve, reject) => {
    Tag.find({name})
    .then(results => {
      resolve(results[0])
    })
  })
}
/**
* This method inserts newly created tags into the database and saves those new tags into the song's tags sub-document array.
* It also saves the song onto the newly create tag's subdocument array of songs.
* Per its name, this method also finds any already existing tags and saves them onto the song if it doesn't yet have that tag.
* And it also saves the song onto the pre-existing tag.
* A Fawn task is passed in to ensure atomicity when adding songs to tags and tags onto songs.
* @param {string[]} tagArray - An array of tag ids (can be a string or integer)
* @param {(string|number)} forSongId - A string or number representing the song's ordinal number.
* @param {object} task - A Fawn task for keeping updates to the db atomic.
* @return {promise} the promise resolves with the updated, not-yet-run Fawn task.
*/
module.exports.addOrInsertTags = (tagArray, forSongId, task) => {
  return new Promise((resolve, reject) => {
    const number = forSongId;
    let counter = tagArray.length;
    for (let tag of tagArray) {
      let num = tag._id.toString();
      if (num.match(/^[0-9a-fA-F]{24}$/)) {
        SongModel.Song.findOne({number})
        .then(song => {
          Tag.findById(tag._id)
          .then(tagDoc => {
            task.update("Song", {number}, {$push: {tags: tagDoc}})
            const hasSong = tagDoc.songs.id(song._id);
            if (!hasSong) {
              task.update("Tag", {_id: tag._id}, {$push: {songs: song}});
            }
            counter -= 1;
            if (counter === 0) {
              resolve(task);
              return;
            }
          })
        })
      } else {
        if (tag.name.length) {
          let newTag = new Tag({name: tag.name, image: tag.image})
          SongModel.Song.findOne({number})
          .then(song => {
            newTag.save()
            .then(savedTag => {
              task.update("Song", {number}, {$push: {tags: savedTag}})
              task.update("Tag", {_id: savedTag._id}, {$push: {songs: song}})
              counter -=1;
              if (counter === 0) {
                resolve(task);
                return;
              }
            })
          })
        } else {
          counter -=1;
          if (counter === 0) {
            resolve(task);
            return;
          }
        }
      }
    }
  })
}

/**
* This method inserts a new tag from with an associated song document. This method is normally used to add a new
* tag that doesn't yet exist to a song directly. The newly inserted tag will get a default associated image name based on the inserted tag name.
* @param {{_id: string, name: string, image: string}} tagData - JSON data representing a tag. Normally in the shape of {name: 'tagname', image: 'filename.png'}
* @param {number} forSongId - An integer representing the song's ordinal number.
* @return {promise} If a SongId is provided, the promise resolves with the inserted tag and updated song. If not, the promise resolves with the newly inserted tag.
*/
module.exports.insertTag = (tagData, forSongId) => {
  return new Promise((resolve, reject) => {
    console.log(tagData, forSongId)
    if (forSongId) {
      let song = SongModel.Song.findOne({number: Number.parseInt(forSongId, 10)})
      .then(song => {
        return song;
      })
      .then(song => {
        let tag = new Tag(tagData);

        tag.songs.push(cleanObj(song));
        tag.save((err, newTag) => {
          if (err) {
            console.log(err);
            reject(err);
          }
          let tagForSong = cleanObj(newTag);
          delete tagForSong.songs;

          song.tags.push(tagForSong)
          song.save((err, updatedSong) => {
            console.log('it saved', newTag, updatedSong);
            resolve({newTag, updatedSong});
          })
        })
      })
    } else {
      
      let tag = new Tag(tagData);
      tag.save((err, newTag) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(newTag)
      })
    }
    
  })
}
/**
* This method retrieves all existing tags in the database and returns them with their name and image properties.
* @return {promise} the promise resolves with an array of the retrieved tags.
*/
module.exports.getAll = () => {
  return new Promise((resolve, reject) => {
    Tag.find({})
    .select('_id name image')
    .sort([['name', -1]])
    .then(results => {
      resolve(results);
    })
    .catch(err => {
      if (err) {
        reject(err);
      }
    })
  })
}

const deleteTags = (tags) => {
  return new Promise((resolve, reject) => {
    Tag.remove({_id: {$in: tags}})
    .then( success => {
      console.log(success)
      resolve()
    })
    .catch(err => {
      if (err) {
        console.log(err);
        reject(err);
      }
    })
  })
}
/**
* This method deletes tags from the database and removes those deleted tags from any song's tag subdoc array which held that tag.
* @param {string[]} tagIdArray - An array of tag ids (strings).
* @return {promise} the promise resolves with all the tags in the database after the removal operation.
*/
module.exports.deleteMany = (tagIdArray, cb) => {
  const recurse = (array) => {
    let task = new Fawn.Task();
    if (!array.length) {
      cb(null);
      return;
    }
    let tag = array.shift();
    Tag.findOne({_id: tag})
    .then(tagDoc => {
      console.log(tagDoc.name)
      task.update("Song", {"tags.name": tagDoc.name}, { $pull: { tags: { name: tagDoc.name}}}, { multi: true })
      task.remove("Tag", {_id: tag} );
      task.run({useMongoose: true})
      .then(success => {
        recurse(array);
      })
    })
  }
  recurse(tagIdArray.slice());
}
/**
* This method collects all updates to tags as an array of tag objects in the shape of {id: somenum, name: 'tag name', image: 'filename string'}
* @param {object[]} tagArray - An array of tag objects.
* @return {promise} the promise resolves with all the tags in the database after the update operation.
*/
module.exports.updateAll = (tagArray) => {
  return new Promise((resolve, reject) => {
    const recurse = (array) => {
      if (!array.length) {
        Tag.find({})
        .select('_id name image')
        .sort([['_id', -1]])
        .then(tags => {
          resolve(tags);
        })
      } else {
        let tag = array.shift();
        if (tag._id.match(/^[0-9a-fA-F]{24}$/)) {
          let task = new Fawn.Task();
          task.update('Tag', {_id: tag._id}, tag)
          SongModel.updateTagsOnSongs(tag, task)
          .then(task => {
            task.run({useMongoose: true})
            .then(success => {
              recurse(array)
            })
          })
        } else {
          if (tag.name.length) {
            console.log('making new! ', tag.name, tag._id)
            let newTag = new Tag({name: tag.name, image: tag.image})
            newTag.save(err => {
              recurse(array)
            })
          } else {
            recurse(array)
          }
        }
      }
    }
    recurse(tagArray.slice())
  })
}

module.exports.Tag = Tag;
module.exports.tagSchema = tagSchema
