var AWSStream = function(sampleRate) {
  const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
  const crypto            = require('crypto'); // tot sign our pre-signed URL
  const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
  const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
  const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8

  // our converter between binary event streams messages and JSON
  const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

  // our global variables for managing state
  let languageCode = "en-GB";
  let region = "eu-west-1";
  let transcription = "";
  let socket;
  let socketError = false;
  let transcribeException = false;
  let opened = false;
  let callbacks = {};
  let emit = function(name, data) {
    var fn, i, len, ref, results;
    ref = callbacks[name];
    results = [];
    for (i = 0, len = ref.length; i < len; i++) {
      fn = ref[i];
      fn(data);
    }
  };


  let startStream = function () {
      //let's get the mic input from the browser, via the microphone-stream module

      // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
      // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
      let url = createPresignedUrl();

      //open up our WebSocket connection
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";

      // when we get audio data from the mic, send it to the WebSocket if possible
      socket.onopen = function() {
          opened = true;
      )};

      // handle messages, errors, and close events
      wireSocketEvents();
  }
  
  let write = function(rawAudioChunk) {
    if(socket && socket.OPEN && opened) {
        let binary = convertAudioToBinaryMessage(rawAudioChunk);

        if (socket.OPEN)
            socket.send(binary);        
    }
  }




  function wireSocketEvents() {
      // handle inbound messages from Amazon Transcribe
      socket.onmessage = function (message) {
          //convert the binary event stream message to JSON
          let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
          let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
          if (messageWrapper.headers[":message-type"].value === "event") {
              handleEventStreamMessage(messageBody);
          }
          else {
              transcribeException = true;
          }
      };

      socket.onerror = function () {
          socketError = true;
          showError('WebSocket connection error. Try again.');
      };

      socket.onclose = function (closeEvent) {

        console.log('aws socket closed');
      };
  }

  let handleEventStreamMessage = function (messageJson) {
      let results = messageJson.Transcript.Results;

      if (results.length > 0) {
          if (results[0].Alternatives.length > 0) {
              emit('transcript', results);
          }
      }
  }

  let closeSocket = function () {
      if (socket.OPEN) {

          // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
          let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
          let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
          socket.send(emptyBuffer);
      }
  }



  function convertAudioToBinaryMessage(audioChunk) {
      let raw = mic.toRaw(audioChunk);

      if (raw == null)
          return;

      // downsample and convert the raw audio bytes to PCM
      let downsampledBuffer = audioUtils.downsampleBuffer(raw, sampleRate);
      let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

      // add the right JSON headers and structure to the message
      let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

      //convert the JSON object + headers into a binary event stream message
      let binary = eventStreamMarshaller.marshall(audioEventMessage);

      return binary;
  }

  function getAudioEventMessage(buffer) {
      // wrap the audio data in a JSON envelope
      return {
          headers: {
              ':message-type': {
                  type: 'string',
                  value: 'event'
              },
              ':event-type': {
                  type: 'string',
                  value: 'AudioEvent'
              }
          },
          body: buffer
      };
  }

  function createPresignedUrl() {
      let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

      // get a preauthenticated URL that we can use to establish our WebSocket
      return v4.createPresignedURL(
          'GET',
          endpoint,
          '/stream-transcription-websocket',
          'transcribe',
          crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
              'key': process.env.AWS_ID,
              'secret': process.env.AWS_KEY,
              'sessionToken': null,
              'protocol': 'wss',
              'expires': 15,
              'region': region,
              'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
          }
      );
  }
  
  return {
    startStream: startStream,
    write: write,
    end: closeSocket,
    on: function(name, fn) {
      callbacks[name] = callbacks[name] || [];
      return callbacks[name].push(fn);
    }
  }
}

module.exports = AWSStream;