let optimisedImages = {};
let originalImages = {};


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  // perform startup processes
  if (request.command === 'startup'){
    const CustomANALYZED_DOMAIN = request.hostname; //retrieve hostname in request from js/find_domain_name.js
    chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
      chrome.declarativeContent.onPageChanged.addRules(
        [{
          conditions: [
            new browser.declarativeContent.PageStateMatcher(
              {
                pageUrl: { hostEquals: CustomANALYZED_DOMAIN },
              })
          ],
          actions: [new browser.declarativeContent.ShowPageAction()]
        }]);
    });

    sendResponse({ "status": "Welcome to ShimmerCat Image Extension" })
  }
  // save image details
  if(request.command === 'imageTransfer'){
    if(request.kind === 'original'){
      originalImages[request.url] = request.image;
    }else{
      optimisedImages[request.url]= {
        "image": request.image
      }
    }

  }
  // perform image fetch 
  if(request.command === 'imageFetch'){
    let headers = new Headers({
      "cache-control": "no-cache",
      "accept": "image/webp, image/avif, image/png,image/*",
      "accept-encoding": "gzip, deflate, br",});
    
      let mode = "cors";

    let fetch_request = new Request(
      request.url,
      {
          "headers": headers,
          "method": "GET",
          "mode": mode,
          "cache": "no-store"
      });
  
    let prom = fetch(fetch_request);

    prom.then(
      (response) => {
          if (response.status === 200) {
            if(request.type === 'original'){
              originalImages[request.url] = request.image;  
            }else{
              optimisedImages[request.url]= {
                "image": request.image
              } 
            }
          }
          else {
              // console.error("error");
          }
      }                                
    ).catch((error) =>{});
  }

  // perform a background chunked image fetch
  if(request.command === 'chunkedImageFetch'){
    let headers = new Headers({
      "cache-control": "no-cache",
      "accept": "image/webp, image/avif, image/png,image/*",
      "accept-encoding": "gzip, deflate, br",});
    
      let mode = "cors";

    let fetch_request = new Request(
      request.url,
      {
          "headers": headers,
          "method": "GET",
          "mode": mode,
          "cache": "no-store"
      });
  
  
    fetch(fetch_request)
    .then((async function (response){
          if (response.status === 200) {
            // compute the complete image size of the chunked image 
            transfer_size = await processChunkedResponse(response).then(onChunkedResponseComplete).catch(onChunkedResponseError);
            // send back to content script
            browser.tabs.query({ active: true, currentWindow: true })
            .then(
              (tabs) => {
                if (tabs.length > 0) {
                  browser.tabs.sendMessage(tabs[0].id, { 
                    transfer_size: transfer_size,
                    status: request.status,
                    pathname: request.pathname,
                    filetype: request.filetype,
                    kind: request.kind,
                    url: request.url
                  })
                    .then(() => {
                        //delete image
                        if(request.kind == 'original'){
                          delete originalImages[request.url]
                          //check if we have processed all images, if we have notify state.js to show model data
                          if(Object.keys(originalImages).length === 0){
                            browser.tabs.query({ active: true, currentWindow: true })
                            .then(
                              (tabs) => {
                                browser.tabs.sendMessage(tabs[0].id, { 
                                  notification: "final image"});
                              })
                          }
                        }else{
                          delete optimisedImages[request.url]
                          //check if we have processed all images, if we have notify state.js to show model data
                          if(Object.keys(optimisedImages).length === 0){
                            browser.tabs.query({ active: true, currentWindow: true })
                            .then(
                              (tabs) => {
                                browser.tabs.sendMessage(tabs[0].id, { 
                                  notification: "final image"});
                              })
                          }
                        } 
                        console.log("message sent to content script") 
                      }
                    )
                    .catch(
                      (error) => {
                        console.error("message was not sent for pathname: " ,request.pathname);
                        console.error(error);
                     }
                    );
                }
              })
            .then(() => {
            })
          }else{
            console.error(error);
          }
        }
    ));
  }
});
const ANALYZED_DOMAIN = 'https://tools.se';

function install_rules() {

  chrome.declarativeContent.onPageChanged.removeRules(undefined, function () {
    chrome.declarativeContent.onPageChanged.addRules(
      [{
        conditions: [
          new browser.declarativeContent.PageStateMatcher(
            {
              pageUrl: { hostEquals: ANALYZED_DOMAIN },
            })
        ],
        actions: [new browser.declarativeContent.ShowPageAction()]
      }]);
  });
}



function install_context_menus() {
  browser.contextMenus.removeAll().then(() => {
    // Let's create the first one: add bad image
    browser.contextMenus.create({
      title: "Mark bad compression",
      id: "mark_bad",
      contexts: ["image"]
    });
    browser.contextMenus.create({
      title: "Mark good compression",
      id: "mark_good",
      contexts: ["image"]
    });
    browser.contextMenus.create({
      title: "Un-mark compression",
      id: "unmark",
      contexts: ["image"]
    });
  });
  browser.contextMenus.onClicked.addListener(on_context_menu_clicked);
}


function on_context_menu_clicked(info, tab) {
  let menu_item_id = info.menuItemId;
  let maybe_url = info.srcUrl;
  if (menu_item_id === "mark_bad" && typeof (maybe_url) == "string" &&
    maybe_url.startsWith("https://" + ANALYZED_DOMAIN)) {
    forward_mark("bad", maybe_url, info);
  } else if (menu_item_id === "mark_good" && typeof (maybe_url) == "string" &&
    maybe_url.startsWith("https://" + ANALYZED_DOMAIN)) {
    forward_mark("good", maybe_url, info);
  } else if (menu_item_id === "unmark" && typeof (maybe_url) == "string" &&
    maybe_url.startsWith("https://" + ANALYZED_DOMAIN)) {
    forward_mark("unmark", maybe_url, info);
  }
}


function forward_mark(mark, maybe_url, info) {
  browser.storage.sync.get(["model_data"]).then((items) => {
    if (items.hasOwnProperty("model_data")) {
      let model_data = items.model_data;
      let url_obj = new URL(maybe_url);
      let pathname = url_obj.pathname;
      for (let imark of ["good", "bad"]) {
        if (imark === mark) {
          model_data[mark + "_images"] = model_data[mark + "_images"] || [];
          let images_list = model_data[mark + "_images"];
          let images_set = new Set(images_list);

          // Add path to set
          images_set.add(pathname);
          let new_images_list = Array.from(images_set);
          model_data[mark + "_images"] = new_images_list;
        } else {
          // Remove path from set
          model_data[imark + "_images"] = model_data[imark + "_images"] || [];
          let images_list = model_data[imark + "_images"];
          let images_set = new Set(images_list);
          images_set.delete(pathname);
          let new_images_list = Array.from(images_set);
          model_data[imark + "_images"] = new_images_list;
        }
      }

      browser.storage.sync.set({
        "model_data": model_data
      })
        .then(() => {

          // noinspection JSCheckFunctionSignatures
          browser.tabs.query({ active: true, currentWindow: true })
            .then(
              (tabs) => {
                if (tabs.length > 0) {
                  browser.tabs.sendMessage(tabs[0].id, { refreshView: true })
                    .then(
                      () => { console.log("message sent to content script") },
                      () => { console.error("message was not sent! ") }
                    );
                }
              })
            .then(() => {
            });

        });
    }
  });
}


browser.runtime.onInstalled.addListener(() => {
  console.log("Background method called");
});

install_context_menus();


chrome.webRequest.onErrorOccurred.addListener(function(details){
  if(details.url in originalImages){
    delete originalImages[details.url]
  }
  if(details.url in optimisedImages){
    delete optimisedImages[details.url]
  }

},
{urls: ["<all_urls>"]},
);

// listener for getting response headers from image requests
chrome.webRequest.onCompleted.addListener(function(details){
  chunked = true;
  // if original image
  if (details.url in originalImages){
    browser.tabs.query({ active: true, currentWindow: true })
            .then(
              (tabs) => {
                if (tabs.length > 0) {
                  // send headers to state.js 
                  return browser.tabs.sendMessage(tabs[0].id, { 
                    headers: details.responseHeaders,
                    image : originalImages[details.url],
                    url : details.url,
                    kind : "original" });
                }
              })
              .then(
                ()=>{
                //delete image
                for (key in Object.keys(details.responseHeaders)){
                  let header = Object.values(details.responseHeaders[key])[0].toLowerCase(); 
                  if (header === "content-length"){
                    chunked = false;
                  }
                }
                if (!chunked){
                  delete originalImages[details.url];  
                }
              },
              (error) => {
                // console.error("error sending headers for: ", details.url);
                // console.error(error);
            })
  }
  // if optimised image
  if (details.url in optimisedImages){
    browser.tabs.query({ active: true, currentWindow: true })
            .then(
              (tabs) => {
                if (tabs.length > 0) {
                  // send headers to state.js 
                  return browser.tabs.sendMessage(tabs[0].id, { 
                    headers: details.responseHeaders,
                    image : optimisedImages[details.url]["image"],
                    url : details.url,
                    kind : "optimised" });
                }
              })
              .then((tabs)=>{
                for (key in Object.keys(details.responseHeaders)){
                  let header = Object.values(details.responseHeaders[key])[0].toLowerCase(); 
                  if (header === "content-length"){
                    chunked = false;
                  }
                }
                if (!chunked){
                  //delete image
                  delete optimisedImages[details.url]
                  //check if we have processed all images, if we have notify state.js to show model data
                  if(Object.keys(optimisedImages).length === 0){
                    browser.tabs.query({ active: true, currentWindow: true })
                    .then(
                      (tabs) => {
                      browser.tabs.sendMessage(tabs[0].id, { 
                        notification: "final image"});
                      })
                  }
                }
              },
              (error) => {
                // console.error("error sending headers for: ", details.url);
                // console.error(error);
            })
  }
},
{urls: ["<all_urls>"]},
["responseHeaders", "extraHeaders"]);

//function to get filetype from headers to filter out non-image requests
function new_filetype_from_headers(headers){
  let result = null;
  for (let
      header_val_arr of headers.entries()) {
      let [header_name, header_value] = header_val_arr;
      let header = header_value["name"]
      let value = header_value['value'];
      if (header.match(/[Cc]ontent-[Tt]ype/)) {
          result = value;
          break;
      }
  }
  return result; 
}



// test functions

// constant to define how much loss compensation to give chunked transfer encoded images
const CHUNKED_IMAGE_LOSS_COMPENSATION_PERCENT = 0.05;


// callback function for returning total chunk size of chunked image transfer
function onChunkedResponseComplete([result, response]) {
  var transfer_size = Math.round(result *(1 + CHUNKED_IMAGE_LOSS_COMPENSATION_PERCENT));
  return transfer_size;
}

// error handler for chunked image transfer
function onChunkedResponseError(err) {
  console.error(err)
}

// function that processes chunked image responses
function processChunkedResponse(response) {
  var count = 0;
  var chunkSize = 0; 
  var reader = response.body.getReader()
  var decoder = new TextDecoder();
  
  return readChunk();

  // use reader to read chunk and pass into appendChunks ready for size aggregation
  function readChunk() {
    return reader.read().then(appendChunks);
  }
  
  // function that adds the length of each chunk to total chunk size in order to compute file size
  function appendChunks(result) {
    var chunk = decoder.decode(result.value || new Uint8Array, {stream: !result.done});
    chunkSize += chunk.length;
    count+=1;
    if (result.done) {
      return [chunkSize, response];
    } else {
          return readChunk();
    }
  }
}
