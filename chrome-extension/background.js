let isListening = false;
let recordingTabId = null;

async function resetState() {
    isListening = false;
    chrome.action.setBadgeText({ text: '' });

    const tabIdToClean = recordingTabId;
    recordingTabId = null;

    if (tabIdToClean) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabIdToClean },
                func: () => {
                    if (window.__agentlemanPip) {
                        try { window.__agentlemanPip.close(); } catch (e) { }
                        window.__agentlemanPip = null;
                    }
                    if (window.__agentlemanPipVideo) {
                        try { document.exitPictureInPicture(); } catch (e) { }
                        window.__agentlemanPipVideo = null;
                    }
                }
            });
        } catch (e) {
            // Tab might be closed or inaccessible
        }
    }

    // Close offscreen document to completely purge buffer and memory
    try {
        await chrome.offscreen.closeDocument();
    } catch (e) {
        // Ignore if already closed
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'recording-stopped-unexpectedly') {
        resetState();
    } else if (message.type === 'log-error') {
        console.error("[Agentleman Offscreen Error]:", message.error);
    } else if (message.type === 'update-pip-image' && recordingTabId) {
        chrome.scripting.executeScript({
            target: { tabId: recordingTabId },
            func: (imageData) => {
                if (window.__agentlemanPip) {
                    const doc = window.__agentlemanPip.document;

                    const newImg = doc.createElement('img');
                    newImg.src = imageData;
                    newImg.style.width = '100vw';
                    newImg.style.height = '100vh';
                    newImg.style.objectFit = 'contain';
                    newImg.style.position = 'absolute';
                    newImg.style.top = '0';
                    newImg.style.left = '0';
                    newImg.style.opacity = '0';
                    newImg.style.transition = 'opacity 3s ease-in-out';

                    // Insert before the progress bar container so it doesn't cover the progress bar
                    const progressBarContainer = doc.getElementById('agentleman-progress-bar')?.parentNode;
                    if (progressBarContainer) {
                        doc.body.insertBefore(newImg, progressBarContainer);
                    } else {
                        doc.body.appendChild(newImg);
                    }

                    // Trigger reflow to ensure transition works
                    void newImg.offsetWidth;
                    newImg.style.opacity = '1';

                    setTimeout(() => {
                        // Clean up all old images to prevent DOM bloat
                        const allImgs = doc.querySelectorAll('img');
                        // Keep only the last one (the newest one)
                        for (let i = 0; i < allImgs.length - 1; i++) {
                            if (allImgs[i].parentNode) {
                                allImgs[i].parentNode.removeChild(allImgs[i]);
                            }
                        }
                    }, 3000);

                } else if (window.__agentlemanPipVideo) {
                    window.__agentlemanPipOldImageSrc = window.__agentlemanPipFallbackImageSrc;
                    window.__agentlemanPipFallbackImageSrc = imageData;

                    const newImgObj = new Image();
                    const oldImgObj = new Image();

                    let newLoaded = false;
                    let oldLoaded = false;

                    const startCrossfade = () => {
                        if (!newLoaded || !oldLoaded) return;

                        let start = performance.now();
                        const duration = 3000;

                        const animate = (time) => {
                            let progress = (time - start) / duration;
                            if (progress > 1) progress = 1;

                            if (window.__agentlemanPipCanvas && window.__agentlemanPipCanvasCtx) {
                                const ctx = window.__agentlemanPipCanvasCtx;

                                // Draw old image
                                ctx.globalAlpha = 1;
                                ctx.fillStyle = '#000';
                                ctx.fillRect(0, 0, 512, 512);
                                ctx.drawImage(oldImgObj, 0, 0, 512, 512);

                                // Draw new image over it with fading opacity
                                ctx.globalAlpha = progress;
                                ctx.drawImage(newImgObj, 0, 0, 512, 512);

                                // Reset alpha for progress bar
                                ctx.globalAlpha = 1;

                                // redraw progress bar
                                if (window.__agentlemanPipProgress !== undefined) {
                                    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                                    ctx.fillRect(0, 0, 512 * (window.__agentlemanPipProgress / 100), 2);
                                }
                            }

                            if (progress < 1) {
                                requestAnimationFrame(animate);
                            }
                        };
                        requestAnimationFrame(animate);
                    };

                    newImgObj.onload = () => { newLoaded = true; startCrossfade(); };
                    oldImgObj.onload = () => { oldLoaded = true; startCrossfade(); };

                    newImgObj.src = imageData;
                    oldImgObj.src = window.__agentlemanPipOldImageSrc || window.__agentlemanPipInitialIconUrl;
                }
            },
            args: [message.imageData]
        }).catch(console.error);
    } else if (message.type === 'update-pip-progress' && recordingTabId) {
        chrome.scripting.executeScript({
            target: { tabId: recordingTabId },
            func: (progress) => {
                if (window.__agentlemanPip) {
                    const doc = window.__agentlemanPip.document;
                    let progressBar = doc.getElementById('agentleman-progress-bar');
                    if (!progressBar) {
                        const container = doc.createElement('div');
                        container.style.position = 'absolute';
                        container.style.top = '0';
                        container.style.left = '0';
                        container.style.width = '100%';
                        container.style.height = '2px';
                        container.style.backgroundColor = 'transparent';
                        container.style.zIndex = '9999'; // Ensure it's above images

                        progressBar = doc.createElement('div');
                        progressBar.id = 'agentleman-progress-bar';
                        progressBar.style.height = '100%';
                        progressBar.style.width = '0%';
                        progressBar.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
                        progressBar.style.transition = 'width 0.2s linear';

                        container.appendChild(progressBar);
                        doc.body.appendChild(container);
                    }
                    progressBar.style.width = `${progress}%`;
                } else if (window.__agentlemanPipVideo) {
                    window.__agentlemanPipProgress = progress;
                    if (window.__agentlemanPipCanvas && window.__agentlemanPipCanvasCtx) {
                        const ctx = window.__agentlemanPipCanvasCtx;

                        // Redraw the image first to clear the old progress bar
                        ctx.fillStyle = '#000';
                        ctx.fillRect(0, 0, 512, 512);

                        const img = new Image();
                        img.onload = () => {
                            ctx.drawImage(img, 0, 0, 512, 512);

                            // Draw new progress bar
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
                            ctx.fillRect(0, 0, 512 * (progress / 100), 2);
                        };
                        img.src = window.__agentlemanPipFallbackImageSrc || window.__agentlemanPipInitialIconUrl;
                    }
                }
            },
            args: [message.progress]
        }).catch(console.error);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recordingTabId) {
        resetState();
    }
});

chrome.action.onClicked.addListener(async (tab) => {
    if (isListening) {
        await resetState();
        return;
    }

    isListening = true;
    chrome.action.setBadgeText({ text: '🟢' });
    chrome.action.setBadgeBackgroundColor({ color: '#000000' });
    recordingTabId = tab.id;

    // Show Picture-in-Picture window
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (iconUrl) => {
            if (window.documentPictureInPicture) {
                window.documentPictureInPicture.requestWindow({
                    width: 512,
                    height: 512,
                    disallowReturnToOpener: true
                })
                    .then(pipWindow => {
                        window.__agentlemanPip = pipWindow;
                        pipWindow.document.title = "";
                        pipWindow.document.body.style.margin = '0';
                        pipWindow.document.body.style.width = '100vw';
                        pipWindow.document.body.style.height = '100vh';
                        pipWindow.document.body.style.overflow = 'hidden';
                        pipWindow.document.body.style.display = 'flex';
                        pipWindow.document.body.style.justifyContent = 'center';
                        pipWindow.document.body.style.alignItems = 'center';
                        pipWindow.document.body.style.backgroundColor = '#000';
                        pipWindow.document.body.style.position = 'relative';

                        const img = pipWindow.document.createElement('img');
                        img.src = iconUrl;
                        img.style.width = '100vw';
                        img.style.height = '100vh';
                        img.style.objectFit = 'contain';
                        img.style.position = 'absolute';
                        img.style.top = '0';
                        img.style.left = '0';
                        pipWindow.document.body.appendChild(img);

                        pipWindow.addEventListener('pagehide', () => {
                            window.__agentlemanPip = null;
                            chrome.runtime.sendMessage({ type: 'recording-stopped-unexpectedly' });
                        });
                    }).catch(console.error);
            } else {
                // Fallback for browsers without Document PiP
                window.__agentlemanPipInitialIconUrl = iconUrl;
                window.__agentlemanPipFallbackImageSrc = iconUrl;
                window.__agentlemanPipProgress = 0;

                const canvas = document.createElement('canvas');
                canvas.width = 512; canvas.height = 512;
                const ctx = canvas.getContext('2d');
                window.__agentlemanPipCanvas = canvas;
                window.__agentlemanPipCanvasCtx = ctx;

                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, 512, 512);
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, 512, 512);
                    const video = document.createElement('video');
                    video.muted = true;
                    video.srcObject = canvas.captureStream();
                    video.play().then(() => {
                        video.requestPictureInPicture().then(() => {
                            window.__agentlemanPipVideo = video;
                            video.addEventListener('leavepictureinpicture', () => {
                                window.__agentlemanPipVideo = null;
                                window.__agentlemanPipCanvas = null;
                                window.__agentlemanPipCanvasCtx = null;
                                chrome.runtime.sendMessage({ type: 'recording-stopped-unexpectedly' });
                            });
                        }).catch(console.error);
                    });
                };
                img.src = iconUrl;
            }
        },
        args: [chrome.runtime.getURL('agentleman.png')]
    }).catch(console.error);

    try {
        const streamId = await new Promise((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(id);
                }
            });
        });

        await setupOffscreenDocument('offscreen.html');

        await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'start-recording',
            streamId: streamId
        });

    } catch (err) {
        console.error("Failed to start recording", err);
        await resetState();
    }
});

async function setupOffscreenDocument(path) {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(path)]
    });

    if (existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['USER_MEDIA'],
        justification: 'Recording audio from the active tab'
    });
}