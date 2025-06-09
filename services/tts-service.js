/**
 * Enhanced TTS Service for SpeakEasy
 * Supports both Web Speech API and OpenTTS with audio caching in documents bucket
 */

// Base URL for the OpenTTS server
const OPENTTS_URL = "https://massage-personnel-postposted-invention.trycloudflare.com "

// TTS Engine types
export const TTS_ENGINES = {
    WEB_SPEECH: "web-speech",
    OPEN_TTS: "open-tts",
}

/**
 * Audio Cache Manager for storing generated audio in documents bucket
 */
class AudioCacheManager {
    constructor() {
        this.memoryCache = new Map()
        this.dbName = "SpeakEasyAudioCache"
        this.dbVersion = 1
        this.storeName = "audioCache"
        this.db = null
        this.initDB()
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion)

            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                this.db = request.result
                resolve(this.db)
            }

            request.onupgradeneeded = (event) => {
                const db = event.target.result
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: "id" })
                    store.createIndex("textHash", "textHash", { unique: false })
                    store.createIndex("voiceId", "voiceId", { unique: false })
                    store.createIndex("engine", "engine", { unique: false })
                    store.createIndex("createdAt", "createdAt", { unique: false })
                }
            }
        })
    }

    generateCacheKey(text, voiceId, engine, speed = 1.0, speaker = null) {
        const normalizedText = text.trim().toLowerCase()
        const keyData = { text: normalizedText, voiceId, engine, speed, speaker }

        try {
            const jsonString = JSON.stringify(keyData)
            let hash = 0
            for (let i = 0; i < jsonString.length; i++) {
                const char = jsonString.charCodeAt(i)
                hash = (hash << 5) - hash + char
                hash = hash & hash
            }

            const enginePrefix = engine === TTS_ENGINES.WEB_SPEECH ? "web" : "tts"
            const voiceShort = voiceId
                .split(":")
                .pop()
                .replace(/[^a-zA-Z0-9]/g, "")
                .substring(0, 10)
            const speedStr = speed.toString().replace(".", "_")
            const speakerStr = speaker ? `-${speaker.replace(/[^a-zA-Z0-9]/g, "")}` : ""

            return `${enginePrefix}-${voiceShort}-${speedStr}${speakerStr}-${Math.abs(hash).toString(36)}`
        } catch (error) {
            console.error("Error generating cache key:", error)
            return `${engine}-${voiceId.split(":").pop()}-${Date.now()}`
        }
    }

    async getCachedAudio(cacheKey) {
        if (this.memoryCache.has(cacheKey)) {
            console.log("Audio found in memory cache")
            return this.memoryCache.get(cacheKey)
        }

        if (!this.db) await this.initDB()

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], "readonly")
            const store = transaction.objectStore(this.storeName)
            const request = store.get(cacheKey)

            request.onsuccess = () => {
                if (request.result) {
                    console.log("Audio found in IndexedDB cache")
                    const audioBlob = new Blob([request.result.audioData], {
                        type: request.result.engine === TTS_ENGINES.WEB_SPEECH ? "application/json" : "audio/wav",
                    })
                    this.memoryCache.set(cacheKey, audioBlob)
                    resolve(audioBlob)
                } else {
                    resolve(null)
                }
            }

            request.onerror = () => reject(request.error)
        })
    }

    async setCachedAudio(cacheKey, audioBlob, metadata = {}) {
        this.memoryCache.set(cacheKey, audioBlob)

        if (!this.db) await this.initDB()

        const audioData = await audioBlob.arrayBuffer()
        const cacheEntry = {
            id: cacheKey,
            audioData: audioData,
            createdAt: Date.now(),
            size: audioBlob.size,
            ...metadata,
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], "readwrite")
            const store = transaction.objectStore(this.storeName)
            const request = store.put(cacheEntry)

            request.onsuccess = () => {
                console.log("Audio cached successfully")
                resolve()
            }
            request.onerror = () => reject(request.error)
        })
    }

    async clearOldCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
        if (!this.db) await this.initDB()

        const cutoffTime = Date.now() - maxAge

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], "readwrite")
            const store = transaction.objectStore(this.storeName)
            const index = store.index("createdAt")
            const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime))

            request.onsuccess = (event) => {
                const cursor = event.target.result
                if (cursor) {
                    cursor.delete()
                    cursor.continue()
                } else {
                    console.log("Old cache entries cleared")
                    resolve()
                }
            }

            request.onerror = () => reject(request.error)
        })
    }

    async getCacheStats() {
        if (!this.db) await this.initDB()

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], "readonly")
            const store = transaction.objectStore(this.storeName)
            const request = store.getAll()

            request.onsuccess = () => {
                const entries = request.result
                const totalSize = entries.reduce((sum, entry) => sum + (entry.size || 0), 0)
                const stats = {
                    totalEntries: entries.length,
                    totalSize: totalSize,
                    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
                    memoryEntries: this.memoryCache.size,
                }
                resolve(stats)
            }

            request.onerror = () => reject(request.error)
        })
    }

    /**
     * Save audio to Supabase documents bucket with organized structure
     * Structure: {userId}/audio/{documentId}/chunk-{index}.{ext}
     */
    async saveAudioToSupabase(audioBlob, metadata, supabase, userId, documentId) {
        try {
            console.log("Saving audio to documents bucket:", {
                userId,
                documentId,
                engine: metadata.engine,
                chunkIndex: metadata.chunkIndex,
                blobSize: audioBlob.size,
            })

            // Validate inputs
            if (!userId || !documentId || !audioBlob || metadata.chunkIndex === undefined) {
                console.error("Missing required parameters for audio save:", {
                    hasUserId: !!userId,
                    hasDocumentId: !!documentId,
                    hasAudioBlob: !!audioBlob,
                    hasChunkIndex: metadata.chunkIndex !== undefined,
                })
                return null
            }

            const fileExtension = metadata.engine === TTS_ENGINES.WEB_SPEECH ? "json" : "wav"
            const fileName = `chunk-${metadata.chunkIndex}.${fileExtension}`
            const filePath = `${userId}/audio/${documentId}/${fileName}`

            console.log("Uploading to documents bucket path:", filePath)

            const { data, error } = await supabase.storage.from("documents").upload(filePath, audioBlob, {
                contentType: metadata.engine === TTS_ENGINES.WEB_SPEECH ? "application/json" : "audio/wav",
                upsert: true, // Allow overwriting existing files
            })

            if (error) {
                console.error("Supabase upload error:", error)
                throw error
            }

            console.log("Upload successful:", data)

            return {
                path: filePath,
                success: true,
            }
        } catch (error) {
            console.error("Error saving audio to Supabase:", error)
            return null
        }
    }

    /**
     * Load audio from Supabase documents bucket using file path
     */
    async loadAudioFromSupabase(filePath, supabase) {
        try {
            console.log("Loading audio from documents bucket path:", filePath)

            const { data, error } = await supabase.storage.from("documents").download(filePath)

            if (error) {
                console.error("Failed to download audio:", error)
                throw error
            }

            console.log("Audio downloaded successfully, size:", data.size)
            return data
        } catch (error) {
            console.error("Error loading audio from Supabase:", error)
            return null
        }
    }

    /**
     * Delete audio files for a specific document
     */
    async deleteDocumentAudio(supabase, userId, documentId) {
        try {
            console.log("Deleting audio files for document:", documentId)

            // List all audio files for this document
            const { data: files, error: listError } = await supabase.storage
                .from("documents")
                .list(`${userId}/audio/${documentId}`)

            if (listError) {
                console.error("Error listing audio files:", listError)
                return false
            }

            if (files && files.length > 0) {
                // Delete all audio files
                const filePaths = files.map((file) => `${userId}/audio/${documentId}/${file.name}`)

                const { error: deleteError } = await supabase.storage.from("documents").remove(filePaths)

                if (deleteError) {
                    console.error("Error deleting audio files:", deleteError)
                    return false
                }

                console.log(`Deleted ${files.length} audio files for document ${documentId}`)
            }

            return true
        } catch (error) {
            console.error("Error deleting document audio:", error)
            return false
        }
    }

    /**
     * NEW: Clear only local cache (IndexedDB and memory), preserve database audio
     */
    async clearLocalCacheOnly() {
        try {
            // Clear local IndexedDB cache
            await this.clearOldCache(0)

            // Clear memory cache
            this.memoryCache.clear()

            console.log("Local audio cache cleared successfully, database audio preserved")
            return true
        } catch (error) {
            console.error("Error clearing local audio cache:", error)
            return false
        }
    }

    /**
     * Clear all audio cache (both local and remote) - only used when deleting reading history
     */
    async clearAllAudioCache(supabase, userId) {
        try {
            // Clear local IndexedDB cache
            await this.clearOldCache(0)

            // Clear memory cache
            this.memoryCache.clear()

            // Clear remote audio files
            const { data: audioFolders, error: listError } = await supabase.storage.from("documents").list(`${userId}/audio`)

            if (listError) {
                console.log("No audio folders found or error listing:", listError)
                return true
            }

            if (audioFolders && audioFolders.length > 0) {
                for (const folder of audioFolders) {
                    if (folder.name) {
                        await this.deleteDocumentAudio(supabase, userId, folder.name)
                    }
                }
            }

            console.log("All audio cache cleared successfully")
            return true
        } catch (error) {
            console.error("Error clearing all audio cache:", error)
            return false
        }
    }
}

// Global cache manager instance
const audioCache = new AudioCacheManager()

/**
 * Get all available voices from OpenTTS
 */
export async function getOpenTTSVoices() {
    try {
        const response = await fetch(`${OPENTTS_URL}/api/voices`)
        if (!response.ok) {
            throw new Error(`Failed to fetch voices: ${response.status}`)
        }
        return await response.json()
    } catch (error) {
        console.error("Error fetching OpenTTS voices:", error)
        return {}
    }
}

/**
 * Get Web Speech API voices
 */
export function getWebSpeechVoices() {
    if (!("speechSynthesis" in window)) return []

    return window.speechSynthesis.getVoices().map((voice) => ({
        id: `web-speech:${voice.name}`,
        name: voice.name,
        language: voice.lang.split("-")[0],
        locale: voice.lang,
        gender: voice.name.toLowerCase().includes("female") ? "F" : "M",
        engine: "web-speech",
        speakers: null,
        multispeaker: false,
        webSpeechVoice: voice,
    }))
}

/**
 * Get all available voices from both engines
 */
export async function getAllVoices() {
    const [openTTSVoices, webSpeechVoices] = await Promise.all([getOpenTTSVoices(), getWebSpeechVoices()])

    const formattedOpenTTS = Object.entries(openTTSVoices).map(([fullId, voice]) => ({
        id: fullId,
        name: `${voice.name} (${voice.gender || "Unknown"}) - OpenTTS`,
        language: voice.language,
        locale: voice.locale,
        gender: voice.gender,
        engine: "open-tts",
        ttsEngine: voice.tts_name,
        speakers: voice.speakers,
        multispeaker: voice.multispeaker,
    }))

    const formattedWebSpeech = webSpeechVoices.map((voice) => ({
        ...voice,
        name: `${voice.name} - Web Speech`,
    }))

    return [...formattedWebSpeech, ...formattedOpenTTS].sort((a, b) => {
        if (a.language !== b.language) {
            return a.language.localeCompare(b.language)
        }
        if (a.engine !== b.engine) {
            return a.engine.localeCompare(b.engine)
        }
        return a.name.localeCompare(b.name)
    })
}

/**
 * Improved text preprocessing for better speech synthesis
 */
export function preprocessTextForSpeech(text, engine = TTS_ENGINES.OPEN_TTS) {
    let processedText = text.trim()

    // Replace multiple spaces with single space
    processedText = processedText.replace(/\s+/g, " ")

    // Fix common punctuation reading issues
    processedText = processedText.replace(/([.!?])\s*([.!?])+/g, "$1") // Remove multiple punctuation
    processedText = processedText.replace(/,\s*,+/g, ",") // Remove multiple commas
    processedText = processedText.replace(/;\s*;+/g, ";") // Remove multiple semicolons

    // Handle abbreviations and acronyms
    processedText = processedText.replace(/\b([A-Z]\.){2,}/g, (match) => {
        return match.replace(/\./g, " ").trim()
    })

    // Handle numbers and decimals
    processedText = processedText.replace(/(\d+)\.(\d+)/g, "$1 point $2")
    processedText = processedText.replace(/\$(\d+)/g, "$1 dollars")
    processedText = processedText.replace(/(\d+)%/g, "$1 percent")

    // Handle URLs and emails
    processedText = processedText.replace(/https?:\/\/[^\s]+/g, "web link")
    processedText = processedText.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "email address")

    if (engine === TTS_ENGINES.WEB_SPEECH) {
        // For Web Speech API, use natural pauses instead of SSML
        processedText = processedText.replace(/([.!?])\s+/g, "$1 ... ")
        processedText = processedText.replace(/([,;])\s+/g, "$1 .. ")
        processedText = processedText.replace(/(:)\s+/g, "$1 ... ")

        // Handle parentheses and quotes
        processedText = processedText.replace(/\(/g, ".. (")
        processedText = processedText.replace(/\)/g, ") ..")
        processedText = processedText.replace(/"/g, " quote ")
        processedText = processedText.replace(/'/g, " ")

        // Remove problematic characters that cause weird reading
        processedText = processedText.replace(/[^\w\s.,!?;:()-]/g, " ")
        processedText = processedText.replace(/\s+/g, " ")
    } else {
        // Use text-based pauses for OpenTTS
        processedText = processedText.replace(/([.!?])\s+/g, "$1... ")
        processedText = processedText.replace(/([,;])\s+/g, "$1.. ")
        processedText = processedText.replace(/(:)\s+/g, "$1... ")
        processedText = processedText.replace(/\(/g, ".. (")
        processedText = processedText.replace(/\)/g, ") ..")
    }

    return processedText
}

/**
 * Split text into chunks for TTS processing
 */
export function splitTextIntoChunks(text, maxChunkSize = 500, engine = TTS_ENGINES.OPEN_TTS) {
    const processedText = preprocessTextForSpeech(text, engine)

    if (processedText.length <= maxChunkSize) {
        return [processedText]
    }

    const chunks = []
    let currentChunk = ""

    const effectiveChunkSize = engine === TTS_ENGINES.WEB_SPEECH ? maxChunkSize * 2 : maxChunkSize

    // Split by sentences first
    const sentences = processedText.split(/([.!?]+\s*)/)

    for (let i = 0; i < sentences.length; i += 2) {
        const sentence = sentences[i] + (sentences[i + 1] || "")

        if (currentChunk.length + sentence.length > effectiveChunkSize) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim())
                currentChunk = ""
            }

            if (sentence.length > effectiveChunkSize) {
                const clauses = sentence.split(/([,;]\s*)/)
                for (let j = 0; j < clauses.length; j += 2) {
                    const clause = clauses[j] + (clauses[j + 1] || "")

                    if (currentChunk.length + clause.length > effectiveChunkSize) {
                        if (currentChunk.trim()) {
                            chunks.push(currentChunk.trim())
                            currentChunk = ""
                        }

                        if (clause.length > effectiveChunkSize) {
                            const words = clause.split(" ")
                            for (const word of words) {
                                if (currentChunk.length + word.length + 1 > effectiveChunkSize) {
                                    if (currentChunk.trim()) {
                                        chunks.push(currentChunk.trim())
                                        currentChunk = ""
                                    }
                                }
                                currentChunk += (currentChunk ? " " : "") + word
                            }
                        } else {
                            currentChunk = clause
                        }
                    } else {
                        currentChunk += clause
                    }
                }
            } else {
                currentChunk = sentence
            }
        } else {
            currentChunk += sentence
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
    }

    return chunks.filter((chunk) => chunk.length > 0)
}

/**
 * Enhanced Web Speech generation with better audio capture
 */
export async function generateWebSpeech(text, voiceId, speed = 1.0) {
    return new Promise((resolve, reject) => {
        if (!("speechSynthesis" in window)) {
            reject(new Error("Web Speech API not supported"))
            return
        }

        const cacheKey = audioCache.generateCacheKey(text, voiceId, TTS_ENGINES.WEB_SPEECH, speed)

        audioCache
            .getCachedAudio(cacheKey)
            .then((cachedAudio) => {
                if (cachedAudio) {
                    resolve(cachedAudio)
                    return
                }

                // For Web Speech API, we'll create a special blob that contains
                // both the text and voice information for playback
                const voices = window.speechSynthesis.getVoices()
                const voice = voices.find((v) => `web-speech:${v.name}` === voiceId)

                const webSpeechData = {
                    text: text,
                    voiceId: voiceId,
                    voiceName: voice ? voice.name : null,
                    speed: speed,
                    engine: TTS_ENGINES.WEB_SPEECH,
                }

                // Store as JSON in a blob
                const webSpeechBlob = new Blob([JSON.stringify(webSpeechData)], { type: "application/json" })

                // Cache the data for future use
                audioCache.setCachedAudio(cacheKey, webSpeechBlob, {
                    engine: TTS_ENGINES.WEB_SPEECH,
                    voiceId,
                    textHash: btoa(text.substring(0, 100)),
                })

                resolve(webSpeechBlob)
            })
            .catch(reject)
    })
}

/**
 * Generate speech using OpenTTS
 */
export async function generateOpenTTSSpeech(text, voiceId, speed = 1.0, speaker = null) {
    try {
        const cacheKey = audioCache.generateCacheKey(text, voiceId, TTS_ENGINES.OPEN_TTS, speed, speaker)
        const cachedAudio = await audioCache.getCachedAudio(cacheKey)

        if (cachedAudio) {
            return cachedAudio
        }

        // Generate new audio
        let voiceParam = voiceId
        if (speaker !== null && speaker !== undefined) {
            voiceParam = `${voiceId}#${speaker}`
        }

        const params = new URLSearchParams({
            voice: voiceParam,
            text: text,
            vocoder: "high",
            denoiserStrength: "0.005",
            cache: "true",
        })

        if (speed !== 1.0) {
            params.append("speed", speed.toString())
        }

        console.log("Generating OpenTTS speech with params:", params.toString())

        const response = await fetch(`${OPENTTS_URL}/api/tts?${params.toString()}`, {
            method: "GET",
            headers: { Accept: "audio/wav" },
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`TTS request failed: ${response.status} - ${errorText}`)
        }

        const audioBlob = await response.blob()
        console.log("OpenTTS audio generated, size:", audioBlob.size)

        // Cache the generated audio
        await audioCache.setCachedAudio(cacheKey, audioBlob, {
            engine: TTS_ENGINES.OPEN_TTS,
            voiceId,
            speaker,
            textHash: btoa(text.substring(0, 100)),
        })

        return audioBlob
    } catch (error) {
        console.error("Error generating OpenTTS speech:", error)
        throw error
    }
}

/**
 * Generate speech using the appropriate engine
 */
export async function generateSpeech(text, voiceId, speed = 1.0, speaker = null) {
    const engine = voiceId.startsWith("web-speech:") ? TTS_ENGINES.WEB_SPEECH : TTS_ENGINES.OPEN_TTS

    if (engine === TTS_ENGINES.WEB_SPEECH) {
        return await generateWebSpeech(text, voiceId, speed)
    } else {
        return await generateOpenTTSSpeech(text, voiceId, speed, speaker)
    }
}

/**
 * Generate speech for multiple text chunks with caching
 */
export async function generateSpeechForChunks(textChunks, voiceId, speed = 1.0, speaker = null, onProgress = null) {
    const audioBlobs = []
    const engine = voiceId.startsWith("web-speech:") ? TTS_ENGINES.WEB_SPEECH : TTS_ENGINES.OPEN_TTS

    console.log(`Generating ${textChunks.length} chunks using ${engine}`)

    // For Web Speech API, we can generate multiple chunks in parallel
    if (engine === TTS_ENGINES.WEB_SPEECH) {
        const promises = textChunks.map(async (chunk, index) => {
            if (onProgress) onProgress(index, textChunks.length)
            return await generateSpeech(chunk, voiceId, speed, speaker)
        })

        const results = await Promise.all(promises)
        if (onProgress) onProgress(textChunks.length, textChunks.length)
        return results
    } else {
        // For OpenTTS, generate sequentially to avoid overwhelming the server
        for (let i = 0; i < textChunks.length; i++) {
            if (onProgress) onProgress(i, textChunks.length)
            const audioBlob = await generateSpeech(textChunks[i], voiceId, speed, speaker)
            audioBlobs.push(audioBlob)
        }

        if (onProgress) onProgress(textChunks.length, textChunks.length)
        return audioBlobs
    }
}

/**
 * Enhanced Audio Queue Manager with dual engine support, proper Web Speech handling,
 * and forward/backward navigation
 */
export class AudioQueueManager {
    constructor() {
        this.audioQueue = []
        this.textChunks = []
        this.currentIndex = 0
        this.isPlaying = false
        this.isPaused = false
        this.currentAudio = null
        this.currentUtterance = null
        this.engine = null
        this.voiceId = null
        this.speed = 1.0
        this.onPlaybackEnd = null
        this.onPlaybackStart = null
        this.onChunkChange = null
        this.isGenerating = false
    }

    // Add this method to get generation status
    getGenerationStatus() {
        return this.isGenerating
    }

    // Add this method to set generation status
    setGenerationStatus(status) {
        this.isGenerating = status
    }

    loadAudioQueue(audioBlobs, engine = TTS_ENGINES.OPEN_TTS, textChunks = [], voiceId = null, speed = 1.0) {
        this.cleanup()
        this.audioQueue = audioBlobs
        this.textChunks = textChunks
        this.currentIndex = 0
        this.engine = engine
        this.voiceId = voiceId
        this.speed = speed
        console.log(`Audio queue loaded: ${audioBlobs.length} chunks, engine: ${engine}`)
    }

    async play() {
        if (this.audioQueue.length === 0) return

        this.isPlaying = true
        this.isPaused = false

        if (this.onPlaybackStart) {
            this.onPlaybackStart()
        }

        await this.playCurrentChunk()
    }

    async playCurrentChunk() {
        if (this.currentIndex >= this.audioQueue.length) {
            this.stop()
            return
        }

        if (this.onChunkChange) {
            this.onChunkChange(this.currentIndex, this.audioQueue.length)
        }

        if (this.engine === TTS_ENGINES.WEB_SPEECH) {
            // Use Web Speech API directly for playback
            return this.playWebSpeechChunk()
        } else {
            // Use audio blob for OpenTTS
            return this.playAudioBlob()
        }
    }

    async playWebSpeechChunk() {
        if (!("speechSynthesis" in window)) {
            console.error("Web Speech API not supported")
            this.stop()
            return
        }

        return new Promise((resolve) => {
            try {
                // Get the blob for this chunk
                const blob = this.audioQueue[this.currentIndex]

                // For Web Speech API, we need to extract the text and voice info from the blob
                blob
                    .text()
                    .then((jsonText) => {
                        const webSpeechData = JSON.parse(jsonText)
                        const text = webSpeechData.text
                        const voiceName = webSpeechData.voiceName
                        const speed = webSpeechData.speed || this.speed

                        console.log("Playing Web Speech chunk:", { text: text.substring(0, 50), voiceName, speed })

                        if (!text) {
                            this.currentIndex++
                            this.playCurrentChunk().then(resolve)
                            return
                        }

                        // Create a new utterance
                        this.currentUtterance = new SpeechSynthesisUtterance(text)

                        // Set voice if available
                        if (voiceName) {
                            const voices = window.speechSynthesis.getVoices()
                            const voice = voices.find((v) => v.name === voiceName)
                            if (voice) {
                                this.currentUtterance.voice = voice
                            }
                        }

                        this.currentUtterance.rate = speed
                        this.currentUtterance.pitch = 1.0
                        this.currentUtterance.volume = 1.0

                        this.currentUtterance.onend = () => {
                            if (this.isPlaying && !this.isPaused) {
                                this.currentIndex++
                                this.playCurrentChunk().then(resolve)
                            } else {
                                resolve()
                            }
                        }

                        this.currentUtterance.onerror = (error) => {
                            console.error("Web Speech playback error:", error)
                            this.currentIndex++
                            if (this.currentIndex < this.audioQueue.length) {
                                this.playCurrentChunk().then(resolve)
                            } else {
                                this.stop()
                                resolve()
                            }
                        }

                        if (this.isPlaying && !this.isPaused) {
                            // Cancel any ongoing speech before starting new one
                            window.speechSynthesis.cancel()
                            window.speechSynthesis.speak(this.currentUtterance)
                        }
                    })
                    .catch((error) => {
                        console.error("Error parsing Web Speech data:", error)
                        this.currentIndex++
                        this.playCurrentChunk().then(resolve)
                    })
            } catch (error) {
                console.error("Error in Web Speech playback:", error)
                this.currentIndex++
                this.playCurrentChunk().then(resolve)
            }
        })
    }

    async playAudioBlob() {
        const audioBlob = this.audioQueue[this.currentIndex]
        const audioUrl = URL.createObjectURL(audioBlob)
        this.currentAudio = new Audio(audioUrl)

        console.log("Playing OpenTTS audio chunk:", this.currentIndex, "size:", audioBlob.size)

        return new Promise((resolve) => {
            this.currentAudio.onended = () => {
                URL.revokeObjectURL(audioUrl)
                if (this.isPlaying && !this.isPaused) {
                    this.currentIndex++
                    this.playCurrentChunk().then(resolve)
                } else {
                    resolve()
                }
            }

            this.currentAudio.onerror = (error) => {
                console.error("Audio playback error:", error)
                URL.revokeObjectURL(audioUrl)
                this.currentIndex++
                if (this.currentIndex < this.audioQueue.length) {
                    this.playCurrentChunk().then(resolve)
                } else {
                    this.stop()
                    resolve()
                }
            }

            if (this.isPlaying && !this.isPaused) {
                this.currentAudio.play().catch((error) => {
                    console.error("Audio play error:", error)
                    URL.revokeObjectURL(audioUrl)
                    this.stop()
                    resolve()
                })
            }
        })
    }

    pause() {
        this.isPaused = true

        if (this.engine === TTS_ENGINES.WEB_SPEECH) {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.pause()
            }
        } else {
            if (this.currentAudio) {
                this.currentAudio.pause()
            }
        }
    }

    resume() {
        this.isPaused = false

        if (this.engine === TTS_ENGINES.WEB_SPEECH) {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume()
            } else if (this.currentUtterance) {
                // If not paused but we have an utterance, restart from current position
                window.speechSynthesis.cancel()
                window.speechSynthesis.speak(this.currentUtterance)
            }
        } else {
            if (this.currentAudio) {
                this.currentAudio.play().catch((error) => {
                    console.error("Audio resume error:", error)
                    this.stop()
                })
            }
        }
    }

    stop() {
        this.isPlaying = false
        this.isPaused = false

        if (this.engine === TTS_ENGINES.WEB_SPEECH) {
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                window.speechSynthesis.cancel()
            }
            this.currentUtterance = null
        } else {
            if (this.currentAudio) {
                this.currentAudio.pause()
                this.currentAudio = null
            }
        }

        this.currentIndex = 0

        if (this.onPlaybackEnd) {
            this.onPlaybackEnd()
        }
    }

    // Forward navigation - go to next chunk
    next() {
        if (this.currentIndex < this.audioQueue.length - 1) {
            const wasPlaying = this.isPlaying

            // Stop current playback properly
            this.stopCurrentChunk()

            // Move to next chunk
            this.currentIndex++

            // Update UI via callback
            if (this.onChunkChange) {
                this.onChunkChange(this.currentIndex, this.audioQueue.length)
            }

            // Resume playback if it was playing
            if (wasPlaying) {
                this.isPlaying = true
                this.isPaused = false
                this.playCurrentChunk()
            }

            return true
        }
        return false
    }

    // Backward navigation - go to previous chunk
    previous() {
        if (this.currentIndex > 0) {
            const wasPlaying = this.isPlaying

            // Stop current playback properly
            this.stopCurrentChunk()

            // Move to previous chunk
            this.currentIndex--

            // Update UI via callback
            if (this.onChunkChange) {
                this.onChunkChange(this.currentIndex, this.audioQueue.length)
            }

            // Resume playback if it was playing
            if (wasPlaying) {
                this.isPlaying = true
                this.isPaused = false
                this.playCurrentChunk()
            }

            return true
        }
        return false
    }

    // Add this helper method to properly stop current chunk
    stopCurrentChunk() {
        if (this.engine === TTS_ENGINES.WEB_SPEECH) {
            if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                window.speechSynthesis.cancel()
            }
            this.currentUtterance = null
        } else if (this.currentAudio) {
            this.currentAudio.pause()
            this.currentAudio.currentTime = 0
            this.currentAudio = null
        }
    }

    seekToChunk(chunkIndex) {
        if (chunkIndex >= 0 && chunkIndex < this.audioQueue.length) {
            const wasPlaying = this.isPlaying

            // Stop current playback
            if (this.engine === TTS_ENGINES.WEB_SPEECH) {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel()
                }
                this.currentUtterance = null
            } else if (this.currentAudio) {
                this.currentAudio.pause()
                this.currentAudio = null
            }

            this.currentIndex = chunkIndex

            // Update UI via callback
            if (this.onChunkChange) {
                this.onChunkChange(this.currentIndex, this.audioQueue.length)
            }

            if (wasPlaying) {
                this.isPlaying = true
                this.isPaused = false
                this.playCurrentChunk()
            }

            return true
        }
        return false
    }

    cleanup() {
        this.stop()
        this.isGenerating = false

        // Clean up any object URLs for OpenTTS audio
        if (this.engine === TTS_ENGINES.OPEN_TTS) {
            this.audioQueue.forEach((blob) => {
                if (typeof blob === "string" && blob.startsWith("blob:")) {
                    URL.revokeObjectURL(blob)
                }
            })
        }

        this.audioQueue = []
        this.textChunks = []
    }

    getStatus() {
        return {
            isPlaying: this.isPlaying,
            isPaused: this.isPaused,
            currentChunk: this.currentIndex,
            totalChunks: this.audioQueue.length,
            progress: this.audioQueue.length > 0 ? (this.currentIndex / this.audioQueue.length) * 100 : 0,
            engine: this.engine,
            hasNext: this.currentIndex < this.audioQueue.length - 1,
            hasPrevious: this.currentIndex > 0,
        }
    }
}

/**
 * Get available languages from voices
 */
export function getAvailableLanguages(voices) {
    const languageMap = {}

    voices.forEach((voice) => {
        if (!languageMap[voice.language]) {
            languageMap[voice.language] = {
                code: voice.language,
                name: getLanguageName(voice.language),
            }
        }
    })

    return Object.values(languageMap).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get human-readable language name from language code
 */
function getLanguageName(code) {
    const languageNames = {
        en: "English",
        fr: "French",
        es: "Spanish",
        de: "German",
        it: "Italian",
        pt: "Portuguese",
        ru: "Russian",
        ja: "Japanese",
        ko: "Korean",
        zh: "Chinese",
        ar: "Arabic",
        hi: "Hindi",
        bn: "Bengali",
        pa: "Punjabi",
        ta: "Tamil",
        te: "Telugu",
        ml: "Malayalam",
        kn: "Kannada",
        mr: "Marathi",
        gu: "Gujarati",
        or: "Oriya",
        as: "Assamese",
        nl: "Dutch",
        tr: "Turkish",
        pl: "Polish",
        cs: "Czech",
        sk: "Slovak",
        hu: "Hungarian",
        ro: "Romanian",
        bg: "Bulgarian",
        el: "Greek",
        fi: "Finnish",
        sv: "Swedish",
        da: "Danish",
        no: "Norwegian",
        is: "Icelandic",
        lt: "Lithuanian",
        lv: "Latvian",
        et: "Estonian",
        uk: "Ukrainian",
        sr: "Serbian",
        hr: "Croatian",
        sl: "Slovenian",
        mk: "Macedonian",
        bs: "Bosnian",
        sq: "Albanian",
        he: "Hebrew",
        vi: "Vietnamese",
        th: "Thai",
        id: "Indonesian",
        ms: "Malay",
        fa: "Persian",
        ur: "Urdu",
        af: "Afrikaans",
        sw: "Swahili",
        zu: "Zulu",
        xh: "Xhosa",
        st: "Sesotho",
        tn: "Setswana",
        cy: "Welsh",
        ga: "Irish",
        gd: "Scottish Gaelic",
        mt: "Maltese",
        eu: "Basque",
        ca: "Catalan",
        gl: "Galician",
        eo: "Esperanto",
        la: "Latin",
        jbo: "Lojban",
        ia: "Interlingua",
        lfn: "Lingua Franca Nova",
        grc: "Ancient Greek",
    }

    return languageNames[code] || code
}

/**
 * Get cache statistics
 */
export async function getCacheStats() {
    return await audioCache.getCacheStats()
}

/**
 * Clear old cache entries
 */
export async function clearOldCache(maxAge) {
    return await audioCache.clearOldCache(maxAge)
}

/**
 * NEW: Clear only local cache, preserve database audio
 */
export async function clearLocalCacheOnly() {
    return await audioCache.clearLocalCacheOnly()
}

/**
 * Clear all audio cache (local and remote) - only for reading history deletion
 */
export async function clearAllAudioCache(supabase, userId) {
    return await audioCache.clearAllAudioCache(supabase, userId)
}

export { audioCache }
