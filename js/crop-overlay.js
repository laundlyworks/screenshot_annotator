(function(){
    if(document.getElementById('ss-crop-overlay'))return;

    var overlay=document.createElement('div');
    overlay.id='ss-crop-overlay';
    overlay.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);cursor:crosshair;z-index:2147483647;';

    var selection=document.createElement('div');
    selection.id='ss-crop-selection';
    selection.style.cssText='position:fixed;border:2px dashed #0088ff;background:rgba(0,136,255,0.1);pointer-events:none;display:none;z-index:2147483647;';

    var startX=0,startY=0,isSelecting=false;

    overlay.addEventListener('mousedown',function(e){
        e.preventDefault();
        startX=e.clientX;
        startY=e.clientY;
        isSelecting=true;
        selection.style.left=startX+'px';
        selection.style.top=startY+'px';
        selection.style.width='0px';
        selection.style.height='0px';
        selection.style.display='block';
    });

    overlay.addEventListener('mousemove',function(e){
        if(!isSelecting)return;
        var currentX=e.clientX,currentY=e.clientY;
        var left=Math.min(startX,currentX);
        var top=Math.min(startY,currentY);
        var width=Math.abs(currentX-startX);
        var height=Math.abs(currentY-startY);
        selection.style.left=left+'px';
        selection.style.top=top+'px';
        selection.style.width=width+'px';
        selection.style.height=height+'px';
    });

    overlay.addEventListener('mouseup',function(e){
        if(!isSelecting)return;
        isSelecting=false;

        var currentX=e.clientX,currentY=e.clientY;
        var left=Math.min(startX,currentX);
        var top=Math.min(startY,currentY);
        var width=Math.abs(currentX-startX);
        var height=Math.abs(currentY-startY);

        if(width<10||height<10){
            cleanup();
            return;
        }

        var dpr=window.devicePixelRatio||1;
        var cropData={
            x:left*dpr,
            y:top*dpr,
            width:width*dpr,
            height:height*dpr,
            displayWidth:width,
            displayHeight:height
        };

        cleanup();
        chrome.runtime.sendMessage({cmd:'bg:crop:selected',cropData:cropData});
    });

    overlay.addEventListener('keydown',function(e){
        if(e.key==='Escape'){
            cleanup();
        }
    });

    function cleanup(){
        overlay.remove();
        selection.remove();
    }

    document.body.appendChild(overlay);
    document.body.appendChild(selection);
    overlay.focus();
})();
