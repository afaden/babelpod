var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var airtunes = require('airtunes');
var spawn = require('child_process').spawn;
var mic = require('mic');
var util = require('util');
var stream = require('stream');
const Speaker = require('speaker');

// Create ToVoid and FromVoid streams so we always have somewhere to send to and from.
util.inherits(ToVoid, stream.Writable);
function ToVoid () {
  if (!(this instanceof ToVoid)) return new ToVoid();
  stream.Writable.call(this);
}
ToVoid.prototype._write = function (chunk, encoding, cb) {
}

util.inherits(FromVoid, stream.Readable);
function FromVoid () {
  if (!(this instanceof FromVoid)) return new FromVoid();
  stream.Readable.call(this);
}
FromVoid.prototype._read = function (chunk, encoding, cb) {
}

var currentInput = "void";
var currentOutput = "void";
var inputStream = new FromVoid();
var outputStream = new ToVoid();
var airplayDevice = null;
var micInstance = null;
var speakerInstance = null;

function cleanupCurrentInput(){
  inputStream.unpipe(outputStream);
  if (micInstance !== null){
    micInstance.stop();
  }
}

function cleanupCurrentOutput(){
  inputStream.unpipe(outputStream);
  if (airplayDevice !== null) {
    airplayDevice.stop(function(){
      console.log('stopped airplay device');
    })
  }
  if (speakerInstance !== null){
    speakerInstance.close();
  }
}

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
  console.log('a user connected');
  socket.emit('switched_input', currentInput);
  socket.emit('switched_output', currentOutput);
  socket.on('disconnect', function(){
    console.log('user disconnected');
  });
  
  socket.on('switch_output', function(msg){
    console.log('switch_output: ' + msg);
    currentOutput = msg;
    cleanupCurrentOutput();
    if (msg === "airplay"){
      var host = "192.168.1.13";
      var port = "7000";
      var volume = "40";
      console.log('adding device: ' + host + ':' + port);
      airplayDevice = airtunes.add(host, {port: port, volume: volume});
      airplayDevice.on('status', function(status) {
        console.log('airplay status: ' + status);
        if(status === 'ready'){
          outputStream = airtunes;
          inputStream.pipe(outputStream);
        }
      });
    }
    if (msg === "speaker"){
      speakerInstance = new Speaker({
        channels: 2,          // 2 channels
        bitDepth: 16,         // 16-bit samples
        sampleRate: 44100     // 44,100 Hz sample rate
      });
      outputStream = speakerInstance;
      inputStream.pipe(outputStream);
    }
    if (msg === "void"){
      outputStream = new ToVoid();
      inputStream.pipe(outputStream);
    }
    io.emit('switched_output', msg);
  });

  socket.on('switch_input', function(msg){
    console.log('switch_input: ' + msg);
    currentInput = msg;
    cleanupCurrentInput();
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
    }
    io.emit('switched_input', msg);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});