let mediaRecorder;
let audioChunks = [];
let audioContext;
let stream;
let isIntentionalStop = false;

let isFirstInterval = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;

    if (message.type === 'start-recording') {
        isIntentionalStop = false;
        isFirstInterval = true;

        startRecording(message.streamId).then(() => {
            sendResponse({ success: true });
        });
        return true;
    } else if (message.type === 'stop-recording') {
        isIntentionalStop = true;
        stopRecording();
        sendResponse({ success: true });
        return false;
    }
});

async function sendAudioToEndpoint(blob) {
    const formData = new FormData();
    formData.append('audio', blob, 'audio.webm');

    try {
        const response = await fetch('https://your-host-here.run.app/process-audio', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const json = await response.json();

            if (json.prompt) {
                console.log("Generated Image Prompt:", json.prompt);
            }

            if (json.image) {
                let imageData = json.image;
                if (!imageData.startsWith('data:')) {
                    imageData = 'data:image/jpeg;base64,' + imageData;
                }

                chrome.runtime.sendMessage({
                    type: 'update-pip-image',
                    imageData: imageData
                });
            }
        } else {
            const errorText = await response.text();
            let parsedError = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.detail) {
                    parsedError = errorJson.detail;
                }
            } catch (e) { }

            const errorMsg = `Endpoint responded with error: ${response.status} - ${parsedError}`;
            console.error(errorMsg);
            chrome.runtime.sendMessage({
                type: 'log-error',
                error: errorMsg
            });
        }
    } catch (err) {
        const errorMsg = `Failed to send audio to endpoint: ${err.message}`;
        console.error(errorMsg);
        chrome.runtime.sendMessage({
            type: 'log-error',
            error: errorMsg
        });
    }
}

async function startRecording(streamId) {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            }
        });

        stream.getTracks().forEach(track => {
            track.onended = () => {
                if (!isIntentionalStop) {
                    chrome.runtime.sendMessage({ type: 'recording-stopped-unexpectedly' });
                }
            };
        });

        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);

        // Important: connect the source to the destination so the user can still hear the tab
        source.connect(audioContext.destination);

        startNewRecordingChunk();

    } catch (err) {
        console.error("Error starting recording:", err);
        chrome.runtime.sendMessage({ type: 'recording-stopped-unexpectedly' });
    }
}

function startNewRecordingChunk() {
    if (isIntentionalStop || !stream) return;

    audioChunks = [];

    const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
    };

    mediaRecorder = new MediaRecorder(stream, options);

    const targetSeconds = isFirstInterval ? 15 : 60;
    const targetChunks = targetSeconds * 10; // Since we record every 100ms

    mediaRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
            audioChunks.push(e.data);

            const progress = (audioChunks.length / targetChunks) * 100;
            chrome.runtime.sendMessage({
                type: 'update-pip-progress',
                progress: Math.min(progress, 100)
            });

            if (audioChunks.length >= targetChunks) {
                if (mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                }
            }
        }
    };

    mediaRecorder.onstop = () => {
        if (isIntentionalStop) return; // Don't process if stopped manually

        const blob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        sendAudioToEndpoint(blob);

        if (isFirstInterval) {
            isFirstInterval = false;
        }

        // Immediately start the next chunk recording so headers are properly written
        startNewRecordingChunk();
    };

    mediaRecorder.start(100);
}

function stopRecording() {
    isIntentionalStop = true;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }
    audioChunks = [];
}