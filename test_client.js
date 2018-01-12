const JSClient = require('./client.js');

var jsc = new JSClient();
jsc.run();

setTimeout(function() {
  console.log("Testing connection...");
  jsc.call("echo", "Hello", function (msg) {
      console.log("Received: ", msg);
      if (msg != "Hello") {
          throw new Error("Return message is incorrect!");
      } else {
          console.log("Correct message recieved!");
      }
  });
}, 2000);

setTimeout(function() {
  console.log("Stopping server...");
  jsc.stop();
}, 5000);
