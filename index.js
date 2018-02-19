var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var airtunes = require('airtunes');
var spawn = require('child_process').spawn;
var mic = require('mic');
var util = require('util')
var stream = require('stream')

util.inherits(ToVoid, stream.Writable);
function ToVoid (opts) {
  if (!(this instanceof ToVoid)) return new ToVoid(opts);

  opts = opts || {};
  stream.Writable.call(this, opts);
}
ToVoid.prototype._write = function (chunk, encoding, cb) {
  setImmediate(cb);
}

util.inherits(FromVoid, stream.Readable);
function FromVoid (opts) {
  if (!(this instanceof FromVoid)) return new FromVoid(opts);

  opts = opts || {};
  stream.Readable.call(this, opts);
}
FromVoid.prototype._read = function (chunk, encoding, cb) {
  // setImmediate(cb);
}

var inputStream = new FromVoid();
var outputStream = new ToVoid();
var airplayDevice = null;
var micInstance = null;

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
  console.log('a user connected');
  socket.on('disconnect', function(){
    console.log('user disconnected');
  });
  
  socket.on('switch_output', function(msg){
    console.log('switch_output: ' + msg);
    inputStream.unpipe(outputStream);
    if (msg === "airplay"){
      var host = "192.168.1.13";
      var port = "7000";
      var volume = "40";
      console.log('adding device: ' + host + ':' + port);
      airplayDevice = airtunes.add(host, {port: port, volume: volume});
      airplayDevice.on('status', function(status) {
        console.log('status: ' + status);

        if(status !== 'ready')
          return;
        outputStream = airtunes;
        inputStream.pipe(outputStream);
      });
    }
    if (msg === "void"){
      outputStream = new ToVoid();
      inputStream.pipe(outputStream);
      // airtunes.stopAll(function() {
      //   console.log('end');
      // }
      if (airplayDevice !== null) {
        airplayDevice.stop(function(){
          console.log('stopped airplay device');
        })
      }
    }
    io.emit('switched_output', msg);
  });

  socket.on('switch_input', function(msg){
    console.log('switch_input: ' + msg);
    inputStream.unpipe(outputStream);
    if (msg === "mic"){
      micInstance = mic({
          rate: '44100',
          channels: '2',
          debug: false,
          exitOnSilence: 0
      });
      inputStream = micInstance.getAudioStream();
      inputStream.pipe(outputStream);
      micInstance.start();
    }
    if (msg === "void"){
      inputStream = new FromVoid();
      inputStream.pipe(outputStream);
      
      micInstance.stop();
    }
    io.emit('switched_input', msg);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});

// monitor buffer events
airtunes.on('buffer', function(status) {
  console.log('buffer ' + status);

  // after the playback ends, give some time to AirTunes devices
  if(status === 'end') {
    console.log('playback ended, waiting for AirTunes devices');
    setTimeout(function() {
      airtunes.stopAll(function() {
        console.log('end');
        process.exit();
      });
    }, 2000);
  }
});


inputStream.on('data', function(data) {
    // console.log("Recieved Input Stream: " + data.length);
});
 
inputStream.on('error', function(err) {
    console.log("Error in Input Stream: " + err);
});
 
inputStream.on('startComplete', function() {
    console.log("Got SIGNAL startComplete");
    setTimeout(function() {
            micInstance.pause();
    }, 10000);
});
    
inputStream.on('stopComplete', function() {
    console.log("Got SIGNAL stopComplete");
});
    
inputStream.on('pauseComplete', function() {
    console.log("Got SIGNAL pauseComplete");
    setTimeout(function() {
        micInstance.resume();
    }, 5000);
});
 
inputStream.on('resumeComplete', function() {
    console.log("Got SIGNAL resumeComplete");
    setTimeout(function() {
        micInstance.stop();
    }, 5000);
});
 
inputStream.on('silence', function() {
    console.log("Got SIGNAL silence");
});
 
inputStream.on('processExitComplete', function() {
    console.log("Got SIGNAL processExitComplete");
});
 
