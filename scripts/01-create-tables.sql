-- Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID DEFAULT gen_random_uuid () PRIMARY KEY,
    user_id UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    theme VARCHAR(20) DEFAULT 'light',
    font_size VARCHAR(20) DEFAULT 'medium',
    speech_rate DECIMAL(3, 1) DEFAULT 1.0,
    voice_name TEXT DEFAULT '',
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW(),
        UNIQUE (user_id)
);

-- Create reading_history table
CREATE TABLE IF NOT EXISTS reading_history (
    id UUID DEFAULT gen_random_uuid () PRIMARY KEY,
    user_id UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    document_name TEXT NOT NULL,
    text_content TEXT,
    storage_path TEXT,
    word_count INTEGER DEFAULT 0,
    char_count INTEGER DEFAULT 0,
    created_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP
    WITH
        TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences (user_id);

CREATE INDEX IF NOT EXISTS idx_reading_history_user_id ON reading_history (user_id);

CREATE INDEX IF NOT EXISTS idx_reading_history_created_at ON reading_history (created_at DESC);