var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var airtunes = require('airtunes');
var spawn = require('child_process').spawn;
var mic = require('mic');
var util = require('util');
var stream = require('stream');
const Speaker = require('speaker');
var mdns = require('mdns-js');
var blue = require("bluetoothctl");
blue.Bluetooth();

var availableInputs = [
  {
    'name': 'None',
    'id': 'void'
  },
  {
    'name': 'Default',
    'id': 'default'
  }
];

blue.on(blue.bluetoothEvents.Device, function (devices) {
  console.log('devices:' + JSON.stringify(devices,null,2));
  availableInputs = [
    {
      'name': 'None',
      'id': 'void'
    },
    {
      'name': 'Default',
      'id': 'default'
    }
  ];
  for (var device of blue.devices){
    availableInputs.push({
      'name': 'Bluetooth: '+device.name,
      'id': 'bluealsa:HCI=hci0,DEV='+device.mac+',PROFILE=a2dp,DELAY=10000'
    });
  }
})

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
var volume = 50;

// find AirPlay speakers
var availableOutputs = [
  {
    'name': 'None',
    'id': 'void',
    'type': 'void'
  },
  {
    'name': 'Speaker/Headphones',
    'id': 'speaker',
    'type': 'speaker'
  }
];
var browser = mdns.createBrowser(mdns.tcp('raop'));
browser.on('ready', function () {
    browser.discover(); 
});
browser.on('update', function (data) {
  // console.log("service up: ", data);
  // console.log(service.addresses);
  // console.log(data.fullname);
  if (data.fullname){
    var splitName = /([^@]+)@(.*)\._raop\._tcp\.local/.exec(data.fullname);
    if (splitName != null && splitName.length > 1){
      availableOutputs.push({
        'name': 'AirPlay: ' + splitName[2],
        'id': 'airplay_'+data.addresses[0]+'_'+data.port,
        'type': 'airplay'
        // 'address': service.addresses[1],
        // 'port': service.port,
        // 'host': service.host
      });
      io.emit('available_outputs', availableOutputs);
    }
  }
  // console.log(airplayDevices);
});
// browser.on('serviceDown', function(service) {
//   console.log("service down: ", service);
// });

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
  // set current state
  socket.emit('available_inputs', availableInputs);
  socket.emit('available_outputs', availableOutputs);
  socket.emit('switched_input', currentInput);
  socket.emit('switched_output', currentOutput);
  socket.emit('changed_output_volume', volume);
  
  socket.on('disconnect', function(){
    console.log('user disconnected');
  });
  
  socket.on('change_output_volume', function(msg){
    console.log('change_output_volume: ', msg);
    volume = msg;
    if (airplayDevice !== null) {
      airplayDevice.setVolume(volume, function(){
        console.log('changed airplay volume');
      })
    }
    if (speakerInstance !== null){
      console.log('todo: update speaker volume somehow');
      //speakerInstance.close();
    }
    io.emit('changed_output_volume', msg);
  });
  
  socket.on('switch_output', function(msg){
    console.log('switch_output: ' + msg);
    currentOutput = msg;
    cleanupCurrentOutput();
    if (msg.startsWith("airplay")){
      var split = msg.split("_");
      var host = split[1];
      var port = split[2];
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
    if (msg === "void"){
      inputStream = new FromVoid();
      inputStream.pipe(outputStream);
    }
    if (msg !== "void"){
      micInstance = mic({
          rate: '44100',
          channels: '2',
          debug: true,
          exitOnSilence: 0,
          device: msg
      });
      inputStream = micInstance.getAudioStream();
      inputStream.pipe(outputStream);
      micInstance.start();
    }
    io.emit('switched_input', msg);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});