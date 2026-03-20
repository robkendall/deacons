import { apiFetch } from "./client";

async function readJson(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

export async function getCurrentUser() {
    const response = await apiFetch("/api/me", {
        credentials: "include",
    });

    const data = await response.json().catch(() => ({ user: null }));
    return data.user || null;
}

export async function login(username, password) {
    const response = await apiFetch("/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, password }),
    });

    const data = await readJson(response);
    return data.user;
}

export async function resetPassword(username, newPassword) {
    const response = await apiFetch("/api/password-reset", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, newPassword }),
    });

    return readJson(response);
}

export async function logout() {
    const response = await apiFetch("/api/logout", {
        method: "POST",
        credentials: "include",
    });

    return readJson(response);
}
