new function(){
    this.imageURL=null;
    this.cropData=null;

    this.loadImageAndOpenEditor=function(t,c){
        e.imageURL=t;
        e.cropData=c||null;
        e.openEditorTab();
    };

    this.openEditorTab=function(){
        chrome.tabs.create({url:chrome.runtime.getURL("edit.html"),selected:!0});
    };

    this.cmd_editReady=function(){
        chrome.runtime.sendMessage({cmd:"edit:ready",imageURL:this.imageURL,cropData:this.cropData});
    };

    this.cmd_deleteCapture=function(){
        this.imageURL=null;
        this.cropData=null;
    };

    var e=this;
    var pendingTabId=null;

    chrome.action.onClicked.addListener(function(t){
        pendingTabId=t.id;
        chrome.scripting.executeScript({
            target:{tabId:t.id},
            files:['js/crop-overlay.js']
        });
    });

    chrome.runtime.onMessage.addListener(function(t,i,n){
        switch(t.cmd){
            case"bg:edit:ready":
                return e.cmd_editReady();
            case"bg:delete_capture":
                return e.cmd_deleteCapture();
            case"bg:crop:selected":
                if(pendingTabId){
                    chrome.tabs.captureVisibleTab(null,{format:"png"},function(img){
                        if(img){
                            e.loadImageAndOpenEditor(img,t.cropData);
                        }
                        pendingTabId=null;
                    });
                }
                return;
        }
    });

    chrome.runtime.onInstalled.addListener(function(){
        chrome.contextMenus.create({id:"static-shot",title:"Screenshot Editorで編集",type:"normal",contexts:["image"]});
    });
    chrome.contextMenus.onClicked.addListener(function(t,i){
        if(!(t&&t.srcUrl))return console.error('Image load failed (check if "Allow access to file URLs" is Enabled)'),!1;
        e.loadImageAndOpenEditor(t.srcUrl,null);
    });
};
