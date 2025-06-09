<script setup>
import { ref, onMounted, computed } from 'vue'
import { useNuxtApp, navigateTo } from 'nuxt/app'
import { audioCache } from '~/services/tts-service'

const user = ref(null)
const documents = ref([])
const isLoading = ref(true)
const error = ref(null)
const searchQuery = ref('')
const sortBy = ref('updated_at')
const sortOrder = ref('desc')
const filterBy = ref('all') // all, completed, in-progress, not-started
const selectedDocuments = ref(new Set())
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)
const { $supabase } = useNuxtApp()

// Computed
const filteredDocuments = computed(() => {
  let filtered = documents.value

  // Apply search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(doc => 
      doc.document_name.toLowerCase().includes(query) ||
      doc.text_content.toLowerCase().includes(query)
    )
  }

  // Apply status filter
  if (filterBy.value !== 'all') {
    filtered = filtered.filter(doc => {
      switch (filterBy.value) {
        case 'completed':
          return doc.is_completed
        case 'in-progress':
          return doc.reading_progress > 0 && !doc.is_completed
        case 'not-started':
          return doc.reading_progress === 0
        default:
          return true
      }
    })
  }

  // Apply sorting
  filtered.sort((a, b) => {
    let aVal = a[sortBy.value]
    let bVal = b[sortBy.value]

    if (sortBy.value === 'created_at' || sortBy.value === 'updated_at') {
      aVal = new Date(aVal)
      bVal = new Date(bVal)
    }

    if (sortOrder.value === 'asc') {
      return aVal > bVal ? 1 : -1
    } else {
      return aVal < bVal ? 1 : -1
    }
  })

  return filtered
})

const totalStats = computed(() => {
  const total = documents.value.length
  const completed = documents.value.filter(doc => doc.is_completed).length
  const inProgress = documents.value.filter(doc => doc.reading_progress > 0 && !doc.is_completed).length
  const notStarted = documents.value.filter(doc => doc.reading_progress === 0).length
  const totalWords = documents.value.reduce((sum, doc) => sum + (doc.word_count || 0), 0)
  const totalReadingTime = documents.value.reduce((sum, doc) => sum + (doc.estimated_reading_time || 0), 0)

  return {
    total,
    completed,
    inProgress,
    notStarted,
    totalWords,
    totalReadingTime
  }
})

// Methods
const loadDocuments = async () => {
  if (!$supabase || !user.value) return

  isLoading.value = true
  error.value = null

  try {
    const { data, error: fetchError } = await $supabase
      .from('reading_history')
      .select('*')
      .eq('user_id', user.value.id)
      .order('updated_at', { ascending: false })

    if (fetchError) throw fetchError

    documents.value = data || []
  } catch (err) {
    console.error('Error loading documents:', err)
    error.value = 'Failed to load reading history. Please try again.'
  } finally {
    isLoading.value = false
  }
}

const openDocument = async (document) => {
  await navigateTo({
    path: '/',
    query: {
      document_id: document.id,
      document_name: document.document_name
    }
  })
}

// MODIFIED: Enhanced document deletion with audio cleanup
const deleteSelectedDocuments = async () => {
  if (selectedDocuments.value.size === 0) return

  isDeleting.value = true

  try {
    const documentIds = Array.from(selectedDocuments.value)
    
    // Delete audio files for each document
    for (const docId of documentIds) {
      console.log('Deleting audio for document:', docId)
      await audioCache.deleteDocumentAudio($supabase, user.value.id, docId)
    }
    
    // Delete documents from database
    const { error: deleteError } = await $supabase
      .from('reading_history')
      .delete()
      .in('id', documentIds)
      .eq('user_id', user.value.id)

    if (deleteError) throw deleteError

    // Remove deleted documents from local state
    documents.value = documents.value.filter(doc => !selectedDocuments.value.has(doc.id))
    selectedDocuments.value.clear()
    showDeleteConfirm.value = false

    console.log(`Successfully deleted ${documentIds.length} documents and their audio files`)

  } catch (err) {
    console.error('Error deleting documents:', err)
    error.value = 'Failed to delete documents. Please try again.'
  } finally {
    isDeleting.value = false
  }
}

const toggleDocumentSelection = (documentId) => {
  if (selectedDocuments.value.has(documentId)) {
    selectedDocuments.value.delete(documentId)
  } else {
    selectedDocuments.value.add(documentId)
  }
}

const selectAllDocuments = () => {
  if (selectedDocuments.value.size === filteredDocuments.value.length) {
    selectedDocuments.value.clear()
  } else {
    selectedDocuments.value = new Set(filteredDocuments.value.map(doc => doc.id))
  }
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getProgressColor = (progress) => {
  if (progress === 0) return 'bg-gray-300'
  if (progress < 25) return 'bg-red-500'
  if (progress < 50) return 'bg-yellow-500'
  if (progress < 75) return 'bg-blue-500'
  if (progress < 100) return 'bg-purple-500'
  return 'bg-green-500'
}

const getStatusBadge = (doc) => {
  if (doc.is_completed) {
    return { text: 'Completed', class: 'bg-green-100 text-green-800' }
  } else if (doc.reading_progress > 0) {
    return { text: 'In Progress', class: 'bg-blue-100 text-blue-800' }
  } else {
    return { text: 'Not Started', class: 'bg-gray-100 text-gray-800' }
  }
}

// NEW: Check if document has saved audio
const hasAudio = (doc) => {
  return doc.audio_file_paths && doc.audio_file_paths.length > 0
}

// Lifecycle
onMounted(async () => {
  try {
    const { data } = await $supabase.auth.getUser()
    user.value = data.user

    if (user.value) {
      await loadDocuments()
    } else {
      await navigateTo('/auth/login')
    }
  } catch (err) {
    console.error('Error getting user:', err)
    await navigateTo('/auth/login')
  }
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 p-4">
    <div class="max-w-7xl mx-auto">
      <!-- Header -->
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-4xl font-bold text-gray-800">📚 Reading History</h1>
          <p class="text-gray-600 mt-2">Track your reading progress and manage your documents</p>
        </div>
        <div class="flex items-center space-x-4">
          <NuxtLink 
            to="/"
            class="py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
          >
            ← Back to Reader
          </NuxtLink>
          <UserProfile v-if="user" :user="user" />
        </div>
      </div>

      <!-- Stats Overview -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center">
            <div class="text-3xl text-blue-600 mr-4">📄</div>
            <div>
              <p class="text-sm text-gray-600">Total Documents</p>
              <p class="text-2xl font-bold text-gray-800">{{ totalStats.total }}</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center">
            <div class="text-3xl text-green-600 mr-4">✅</div>
            <div>
              <p class="text-sm text-gray-600">Completed</p>
              <p class="text-2xl font-bold text-gray-800">{{ totalStats.completed }}</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center">
            <div class="text-3xl text-purple-600 mr-4">📖</div>
            <div>
              <p class="text-sm text-gray-600">In Progress</p>
              <p class="text-2xl font-bold text-gray-800">{{ totalStats.inProgress }}</p>
            </div>
          </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
          <div class="flex items-center">
            <div class="text-3xl text-orange-600 mr-4">⏱️</div>
            <div>
              <p class="text-sm text-gray-600">Total Reading Time</p>
              <p class="text-2xl font-bold text-gray-800">{{ totalStats.totalReadingTime }}m</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters and Search -->
      <div class="bg-white rounded-lg shadow-md p-6 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <!-- Search -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Search Documents</label>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search by name or content..."
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
            />
          </div>
          
          <!-- Filter by Status -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Filter by Status</label>
            <select 
              v-model="filterBy"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Documents</option>
              <option value="completed">Completed</option>
              <option value="in-progress">In Progress</option>
              <option value="not-started">Not Started</option>
            </select>
          </div>
          
          <!-- Sort By -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
            <select 
              v-model="sortBy"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
            >
              <option value="updated_at">Last Updated</option>
              <option value="created_at">Date Created</option>
              <option value="document_name">Document Name</option>
              <option value="reading_progress">Progress</option>
              <option value="word_count">Word Count</option>
            </select>
          </div>
          
          <!-- Sort Order -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Order</label>
            <select 
              v-model="sortOrder"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Bulk Actions -->
      <div v-if="selectedDocuments.size > 0" class="bg-white rounded-lg shadow-md p-4 mb-6">
        <div class="flex justify-between items-center">
          <span class="text-sm text-gray-600">
            {{ selectedDocuments.size }} document(s) selected
          </span>
          <button
            @click="showDeleteConfirm = true"
            class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            🗑️ Delete Selected (Including Audio)
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="bg-white rounded-lg shadow-md p-12 text-center">
        <div class="text-4xl mb-4">⏳</div>
        <p class="text-gray-600">Loading your reading history...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="bg-white rounded-lg shadow-md p-12 text-center">
        <div class="text-4xl mb-4">❌</div>
        <p class="text-red-600 mb-4">{{ error }}</p>
        <button 
          @click="loadDocuments"
          class="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
        >
          Try Again
        </button>
      </div>

      <!-- Empty State -->
      <div v-else-if="filteredDocuments.length === 0 && documents.length === 0" class="bg-white rounded-lg shadow-md p-12 text-center">
        <div class="text-6xl mb-4">📚</div>
        <h3 class="text-xl font-semibold text-gray-800 mb-2">No Documents Yet</h3>
        <p class="text-gray-600 mb-6">Start by uploading or pasting text in the main reader.</p>
        <NuxtLink 
          to="/"
          class="inline-block px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
        >
          Go to Reader
        </NuxtLink>
      </div>

      <!-- No Results State -->
      <div v-else-if="filteredDocuments.length === 0" class="bg-white rounded-lg shadow-md p-12 text-center">
        <div class="text-4xl mb-4">🔍</div>
        <h3 class="text-xl font-semibold text-gray-800 mb-2">No Results Found</h3>
        <p class="text-gray-600">Try adjusting your search or filter criteria.</p>
      </div>

      <!-- Documents List -->
      <div v-else class="space-y-4">
        <!-- Select All -->
        <div class="bg-white rounded-lg shadow-md p-4">
          <label class="flex items-center cursor-pointer">
            <input
              type="checkbox"
              :checked="selectedDocuments.size === filteredDocuments.length && filteredDocuments.length > 0"
              :indeterminate="selectedDocuments.size > 0 && selectedDocuments.size < filteredDocuments.length"
              @change="selectAllDocuments"
              class="mr-3"
            />
            <span class="text-sm font-medium text-gray-700">
              Select All ({{ filteredDocuments.length }} documents)
            </span>
          </label>
        </div>
        
        <!-- Document Cards -->
        <div v-for="document in filteredDocuments" :key="document.id" class="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
          <div class="p-6">
            <div class="flex items-start justify-between">
              <!-- Selection Checkbox -->
              <div class="flex items-start space-x-4">
                <input
                  type="checkbox"
                  :checked="selectedDocuments.has(document.id)"
                  @change="toggleDocumentSelection(document.id)"
                  class="mt-1"
                />
                
                <!-- Document Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center space-x-3 mb-2">
                    <h3 class="text-lg font-semibold text-gray-800 truncate">
                      {{ document.document_name }}
                    </h3>
                    <span 
                      class="px-2 py-1 text-xs font-medium rounded-full"
                      :class="getStatusBadge(document).class"
                    >
                      {{ getStatusBadge(document).text }}
                    </span>
                    <!-- NEW: Audio indicator -->
                    <span v-if="hasAudio(document)" class="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                      🎵 Audio Saved
                    </span>
                  </div>
                  
                  <!-- Progress Bar -->
                  <div class="mb-3">
                    <div class="flex justify-between text-sm text-gray-600 mb-1">
                      <span>Reading Progress</span>
                      <span>{{ document.reading_progress }}%</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        class="h-2 rounded-full transition-all duration-300"
                        :class="getProgressColor(document.reading_progress)"
                        :style="{ width: `${document.reading_progress}%` }"
                      ></div>
                    </div>
                  </div>
                  
                  <!-- Document Stats -->
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 mb-3">
                    <div>
                      <span class="font-medium">Words:</span> {{ document.word_count?.toLocaleString() || 0 }}
                    </div>
                    <div>
                      <span class="font-medium">Est. Time:</span> {{ document.estimated_reading_time || 0 }}m
                    </div>
                    <div>
                      <span class="font-medium">Created:</span> {{ formatDate(document.created_at) }}
                    </div>
                    <div>
                      <span class="font-medium">Updated:</span> {{ formatDate(document.updated_at) }}
                    </div>
                  </div>
                  
                  <!-- NEW: Audio info -->
                  <div v-if="hasAudio(document)" class="text-sm text-blue-600 mb-3">
                    <span class="font-medium">Audio:</span> {{ document.audio_chunk_count }} chunks saved
                    <span v-if="document.audio_settings" class="text-gray-500">
                      ({{ document.audio_settings.engine }}, {{ document.audio_settings.speed }}x speed)
                    </span>
                  </div>
                  
                  <!-- Text Preview -->
                  <p class="text-sm text-gray-600 line-clamp-2">
                    {{ document.text_content?.substring(0, 200) }}...
                  </p>
                </div>
              </div>
              
              <!-- Actions -->
              <div class="flex flex-col space-y-2 ml-4">
                <button
                  @click="openDocument(document)"
                  class="px-4 py-2 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 transition-colors"
                >
                  {{ document.reading_progress > 0 ? 'Continue Reading' : 'Start Reading' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Delete Confirmation Modal -->
      <div v-if="showDeleteConfirm" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 class="text-lg font-semibold text-gray-800 mb-4">⚠️ Confirm Deletion</h3>
          <p class="text-gray-600 mb-4">
            Are you sure you want to delete {{ selectedDocuments.size }} document(s)? 
          </p>
          <div class="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
            <p class="text-sm text-yellow-800">
              <strong>⚠️ Warning:</strong> This will permanently delete:
            </p>
            <ul class="text-sm text-yellow-700 mt-2 ml-4 list-disc">
              <li>Document text and reading progress</li>
              <li>All saved audio files for these documents</li>
              <li>This action cannot be undone</li>
            </ul>
          </div>
          <div class="flex justify-end space-x-4">
            <button
              @click="showDeleteConfirm = false"
              :disabled="isDeleting"
              class="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              @click="deleteSelectedDocuments"
              :disabled="isDeleting"
              class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {{ isDeleting ? 'Deleting...' : 'Delete Documents & Audio' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>