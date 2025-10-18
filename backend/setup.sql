-- SQL schema for application
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    oauth_provider VARCHAR(20) NOT NULL,
    oauth_id VARCHAR(100) NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    name VARCHAR(255) DEFAULT NULL,
    avatar VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (oauth_provider, oauth_id)
);

CREATE TABLE sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE favorites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    item_id VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE comparisons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    item_left VARCHAR(50) NOT NULL,
    item_right VARCHAR(50) NOT NULL,
    item_names TEXT DEFAULT NULL,
    item_ids TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
