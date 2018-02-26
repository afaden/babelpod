var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var airtunes = require('airtunes');
var spawn = require('child_process').spawn;
var util = require('util');
var stream = require('stream');
var mdns = require('mdns-js');
var blue = require("bluetoothctl");
var fs = require('fs');

var availableInputs = [
  {
    'name': 'None',
    'id': 'void'
  }
];

var pcmDevicesString = fs.readFileSync('/proc/asound/pcm', 'utf8');
var pcmDevicesArray = pcmDevicesString.split("\n").filter(line => line!="");
var pcmDevices = pcmDevicesArray.map(device => {var splitDev = device.split(":");return {id: "plughw:"+splitDev[0].split("-").map(num => parseInt(num, 10)).join(","), name:splitDev[2].trim(), output: splitDev.some(part => part.includes("playback")), input: splitDev.some(part => part.includes("capture"))}});

var inputPcmDevices = pcmDevices.filter(dev => dev.input);
inputPcmDevices.forEach(dev => availableInputs.push(dev));

blue.Bluetooth();
blue.on(blue.bluetoothEvents.Device, function (devices) {
  console.log('devices:' + JSON.stringify(devices,null,2));  
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
var arecordInstance = null;
var aplayInstance = null;
var volume = 50;

// find AirPlay speakers
var availableOutputs = [
  {
    'name': 'None',
    'id': 'void',
    'type': 'void'
  }
];

var outputPcmDevices = pcmDevices.filter(dev => dev.output);
outputPcmDevices.forEach(dev => availableOutputs.push(dev));

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
  if (arecordInstance !== null){
    arecordInstance.kill();
  }
}

function cleanupCurrentOutput(){
  inputStream.unpipe(outputStream);
  if (airplayDevice !== null) {
    airplayDevice.stop(function(){
      console.log('stopped airplay device');
    })
    airplayDevice = null;
  }
  if (aplayInstance !== null){
    aplayInstance.kill();
    aplayInstance = null;
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
    if (aplayInstance !== null){
      console.log('todo: update speaker volume somehow');
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
    if (msg.startsWith("plughw:")){
      aplayInstance = spawn("aplay", [
        '-D', msg,
        '-c', "2",
        '-f', "S16_LE",
        '-r', "44100"
      ]);

      outputStream = aplayInstance.stdin;
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
      arecordInstance = spawn("arecord", [
        '-D', msg,
        '-c', "2",
        '-f', "S16_LE",
        '-r', "44100"
      ]);
      inputStream = arecordInstance.stdout;

      inputStream.pipe(outputStream);
    }
    io.emit('switched_input', msg);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});