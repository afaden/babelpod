var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var spawn = require('child_process').spawn;
var util = require('util');
var stream = require('stream');
var mdns = require('dnssd2');
var fs = require('fs');
var AirTunes = require('airtunes2');
var blue = require('bluetoothctl');
const { error } = require('console');

var airtunes = new AirTunes();

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
var airplayDevices = [];
var arecordInstance = null;
var aplayInstance = null;
var volume = 20;
var availableOutputs = [];
var availablePcmOutputs = []
var availableAirplayOutputs = [];
var availableAirplayStereoOutputs = {}
var availableInputs = [];
var availableBluetoothInputs = [];
var availablePcmInputs = [];

// Search for new PCM input/output devices
function pcmDeviceSearch(){
  try {
    var pcmDevicesString = fs.readFileSync('/proc/asound/pcm', 'utf8');
  } catch (e) {
    console.log("audio input/output pcm devices could not be found");
    return;
  }
  var pcmDevicesArray = pcmDevicesString.split("\n").filter(line => line!="");
  var pcmDevices = pcmDevicesArray.map(device => {var splitDev = device.split(":");return {id: "plughw:"+splitDev[0].split("-").map(num => parseInt(num, 10)).join(","), name:splitDev[2].trim(), output: splitDev.some(part => part.includes("playback")), input: splitDev.some(part => part.includes("capture"))}});
  availablePcmOutputs = pcmDevices.filter(dev => dev.output);
  availablePcmInputs = pcmDevices.filter(dev => dev.input);
  updateAllInputs();
  updateAllOutputs();
}
// Perform initial search for PCM devices
pcmDeviceSearch();

// Watch for new PCM input/output devices every 10 seconds
var pcmDeviceSearchLoop = setInterval(pcmDeviceSearch, 10000);

// Watch for new Bluetooth devices
blue.Bluetooth();
setTimeout(() => blue.getPairedDevices(), 5000)

blue.on(blue.bluetoothEvents.Device, function (devices) {
  // ('devices:' + JSON.stringify(devices,null,2));
  availableBluetoothInputs = [];
  for (var device of blue.devices){
    availableBluetoothInputs.push({
      'name': 'Bluetooth: '+device.name,
      'id': 'bluealsa:SRV=org.bluealsa,DEV='+device.mac+',PROFILE=a2dp',
      'mac': device.mac,
      'connected': device.connected == 'yes'
    });
  }
  updateAllInputs();
})

function updateAllInputs(){
  var defaultInputs = [
    {
      'name': 'None',
      'id': 'void'
    }
  ];
  availableInputs = defaultInputs.concat(availablePcmInputs, availableBluetoothInputs);
  // todo only emit if updated
  io.emit('available_inputs', availableInputs);
}
updateAllInputs();

function updateAllOutputs(){
  var defaultOutputs = [
    {
      'name': 'None',
      'id': 'void',
      'type': 'void',
      'stereo': 'void'
    }
  ];
  availableOutputs = defaultOutputs.concat(availablePcmOutputs, Object.values(availableAirplayStereoOutputs), availableAirplayOutputs);
  // todo only emit if updated
  io.emit('available_outputs', availableOutputs);
}
updateAllOutputs();

// var browser = mdns.createBrowser(mdns.tcp('raop'));
// browser.on('ready', function () {
//     browser.discover(); 
// });
// browser.on('update', function (data) {
//   // console.log("service up: ", data);
//   // console.log(service.addresses);
//   // console.log(data.fullname);
//   if (data.fullname){
//     var splitName = /([^@]+)@(.*)\._raop\._tcp\.local/.exec(data.fullname);
//     if (splitName != null && splitName.length > 1){
//       var id = 'airplay_'+data.addresses[0]+'_'+data.port;

//       if (!availableAirplayOutputs.some(e => e.id === id)) {
//         availableAirplayOutputs.push({
//           'name': 'AirPlay: ' + splitName[2],
//           'id': id,
//           'type': 'airplay',
//           // 'address': service.addresses[1],
//           // 'port': service.port,
//           // 'host': service.host
//         });
//         updateAllOutputs();
//       }
//     }
//   }
//   // console.log(airplayDevices);
// });
// // browser.on('serviceDown', function(service) {
// //   console.log("service down: ", service);
// // });

var browser = mdns.Browser(mdns.tcp('airplay'));

browser.on('serviceUp', function (data) {
  // console.log("service up: ", data);
  // console.log(service.addresses);
  // console.log(data.fullname);
  if (data.fullname){
    var splitName = /(.*)\._airplay\._tcp\.local/.exec(data.fullname);
    if (splitName != null && splitName.length > 1){
      var id = 'airplay_'+data.addresses[0]+'_'+data.port;
      var stereoName = false;
      var tv = false;
      stereoName = data.txt.gpn || false
      tv = data.txt.model && data.txt.model.includes('AppleTV') || tv
      if (tv && stereoName) return
      
      if (stereoName) {
        if (!availableAirplayStereoOutputs[stereoName]) 
          availableAirplayStereoOutputs[stereoName] = {
            'id': 'stereoAirplay_' + stereoName,
            'name': 'AirPlay: ' + stereoName,
            'type': 'stereoAirplay',
            'devices': []
          }
        availableAirplayStereoOutputs[stereoName].devices.push({
          'name': 'AirPlay: ' + splitName[1],
          'id': id,
          'type': 'airplay',
          'host': data.addresses[0],
          'port': data.port
          // 'host': service.host
        })
      } else
        availableAirplayOutputs.push({
          'name': 'AirPlay: ' + splitName[1],
          'id': id,
          'type': 'airplay',
          'host': data.addresses[0],
          'port': data.port
          // 'host': service.host
        })
      updateAllOutputs()
    }
  }
  // console.log(airplayDevices);
});
browser.on('serviceChanged', function(data) {
  if (data.fullname) {
    var splitName = /(.*)\._airplay\._tcp\.local/.exec(data.fullname);
    if (splitName != null && splitName.length > 1) {
      var id = 'airplay_'+data.addresses[0]+'_'+data.port;
      var stereoName = false;
      var tv = false;

      stereoName = data.txt.gpn || false
      tv = data.txt.model && data.txt.model.includes('AppleTV') || tv
      if (tv && stereoName) return

      if (stereoName) {
        var device = availableAirplayStereoOutputs[stereoName].devices.find(dev => dev.id === id)
        device.name = 'AirPlay: ' + splitName[1]
        device.host = data.addresses[0]
        device.port = data.port
      } else {
        var device = availableAirplayOutputs.find(dev => dev.id === id)
        device.name = 'AirPlay: ' + splitName[1]
        device.host = data.addresses[0]
        device.port = data.port
      }

      updateAllOutputs()
    }
  }
})

browser.on('serviceDown', function(data) {
  if (data.fullname){
    var splitName = /(.*)\._airplay\._tcp\.local/.exec(data.fullname);
    if (splitName != null && splitName.length > 1){
      var id = 'airplay_'+data.addresses[0]+'_'+data.port;
      var stereoName = false;
      var tv = false;

      stereoName = data.txt.gpn || false
      tv = data.txt.model && data.txt.model.includes('AppleTV') || tv
      if (tv && stereoName) return
      if (stereoName)
        availableAirplayStereoOutputs = availableAirplayStereoOutputs.some(e => e.id !== stereoName)
      else
        availableAirplayOutputs = availableAirplayOutputs.some(e => e.id !== id)

      updateAllOutputs()
    }
  }
});

browser.start()

function cleanupCurrentInput(){
  inputStream.unpipe(outputStream);
  if (arecordInstance !== null){
    arecordInstance.kill();
    arecordInstance = null;
  }
}

function statHandler(status) {
  console.log('airplay status: ' + status);
  if(status === 'ready'){

    // at this moment the rtsp setup is not fully done yet and the status
    // is still SETVOLUME. There's currently no way to check if setup is
    // completed, so we just wait a second before setting the track info.
    // Unfortunately we don't have the fancy input name here. Will get fixed
    // with a better way of storing devices.
    setTimeout(() => { this.setTrackInfo(currentInput, 'BabelPod', '') }, 1000);
  }
}

function errorHandler(error) {
  console.log('airplay error: ' + error);
  this.stop(function() {
    console.log('device was stopped')
  })
}

function cleanupCurrentOutput(){
  inputStream.unpipe(outputStream);
  airplayDevices.forEach(airplayDevice => {
    if (airplayDevice !== null) {
      airplayDevice.stop(function(){
        console.log('stopped airplay device');
      })
      airplayDevice.off('status', statHandler)
      airplayDevice = null;
    }
  })

  airplayDevices = []

  if (aplayInstance !== null){
    aplayInstance.kill();
    aplayInstance = null;
  }
}

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

let logPipeError = function(e) {console.log('inputStream.pipe error: ' + e.message)};



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
    airplayDevices.forEach(airplayDevice => {
      if (airplayDevice !== null) {
        airplayDevice.setVolume(volume, function(){
          console.log('changed airplay volume');
        });
      }
    })
    
    if (aplayInstance !== null){
      console.log('todo: update correct speaker based on currentOutput device ID');
      console.log(currentOutput);
      var amixer = spawn("amixer", [
        '-c', "1",
        '--', "sset",
        'Speaker', volume+"%"
      ]);
    }
    io.emit('changed_output_volume', msg);
  });

  socket.on('switch_output', function(msg){
    console.log('switch_output: ' + msg);
    currentOutput = msg;
    cleanupCurrentOutput();

    // TODO: rewrite how devices are stored to avoid the array split thingy
    if (msg.startsWith("stereoAirplay")) {
      selectedOutput = availableAirplayStereoOutputs[msg.substring(14)];
      selectedOutput.devices.forEach(device => {
        console.log('adding device: ' + device.host + ':' + device.port);
        var airplayDevice = airtunes.add(device.host, {port: device.port, volume: volume, stereo: true})
        airplayDevice.on('error', errorHandler)
  
  
        airplayDevice.on('status', statHandler);
        airplayDevices.push(airplayDevice)
      })


      outputStream = airtunes;
      inputStream.pipe(outputStream, {end: false}).on('error', logPipeError);
    }
    if (msg.startsWith("airplay")) {
      selectedOutput = availableAirplayOutputs.find(output => output.id === msg);

      console.log('adding device: ' + selectedOutput.host + ':' + selectedOutput.port);
      var airplayDevice = airtunes.add(selectedOutput.host, {port: selectedOutput.port, volume: volume, stereo: false})
      airplayDevice.on('error', errorHandler)


      airplayDevice.on('status', statHandler);
      airplayDevices.push(airplayDevice)

      outputStream = airtunes;
      inputStream.pipe(outputStream, {end: false}).on('error', logPipeError);
    }
    if (msg.startsWith("plughw:")){
      aplayInstance = spawn("aplay", [
        '-D', msg,
        '-c', "2",
        '-f', "S16_LE",
        '-r', "44100"
      ]);

      outputStream = aplayInstance.stdin;
      inputStream.pipe(outputStream).on('error', logPipeError);
    }
    if (msg === "void"){
      outputStream = new ToVoid();
      inputStream.pipe(outputStream).on('error', logPipeError);
    }
    io.emit('switched_output', msg);
  });

  socket.on('switch_input', function(msg){
    console.log('switch_input: ' + msg);
    currentInput = msg;
    cleanupCurrentInput();
    if (msg === "void"){
      inputStream = new FromVoid();
      if (outputStream === airtunes)
        inputStream.pipe(outputStream, {end: false}).on('error', logPipeError);
      else
        inputStream.pipe(outputStream).on('error', logPipeError);
    }
    if (msg !== "void"){
      if (msg.includes('bluealsa')) {
        let theOutput = availableBluetoothInputs.find(object => object.id === msg);
        if (theOutput.connected == false) {
          blue.connect(theOutput.mac)
          setTimeout(function() {
            blue.info(theOutput.mac)
            arecordInstance = spawn("arecord", [
              '-D', msg,
              '-c', "2",
              '-f', "S16_LE",
              '-r', "44100"
            ]);
            inputStream = arecordInstance.stdout;
      
            inputStream.pipe(outputStream).on('error', logPipeError);

            io.emit('switched_input', msg);
          }, 5000)
          return;
        }
      }
      arecordInstance = spawn("arecord", [
        '-D', msg,
        '-c', "2",
        '-f', "S16_LE",
        '-r', "44100"
      ]);
      inputStream = arecordInstance.stdout;

      inputStream.pipe(outputStream).on('error', logPipeError);
      
    }
    io.emit('switched_input', msg);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});
