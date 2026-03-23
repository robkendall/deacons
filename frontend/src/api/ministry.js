import { apiFetch } from "./client";

async function readJson(response) {
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Request failed.");
    }

    return data;
}

async function request(path, options = {}) {
    const response = await apiFetch(path, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });

    return readJson(response);
}

export function getAssignableUsers() {
    return request("/api/users/assignable");
}

export function getUsers() {
    return request("/api/users");
}

export function createUser(payload) {
    return request("/api/users", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateUser(id, payload) {
    return request(`/api/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteUser(id) {
    return request(`/api/users/${id}`, {
        method: "DELETE",
    });
}

export function getWidows() {
    return request("/api/widows");
}

export function createWidow(payload) {
    return request("/api/widows", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateWidow(id, payload) {
    return request(`/api/widows/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteWidow(id) {
    return request(`/api/widows/${id}`, {
        method: "DELETE",
    });
}

export function getBenevolence() {
    return request("/api/benevolence");
}

export function createBenevolence(payload) {
    return request("/api/benevolence", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateBenevolence(id, payload) {
    return request(`/api/benevolence/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteBenevolence(id) {
    return request(`/api/benevolence/${id}`, {
        method: "DELETE",
    });
}

export function getWork() {
    return request("/api/work");
}

export function createWork(payload) {
    return request("/api/work", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateWork(id, payload) {
    return request(`/api/work/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteWork(id) {
    return request(`/api/work/${id}`, {
        method: "DELETE",
    });
}

export function getCalendar(month) {
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    return request(`/api/calendar${query}`);
}

export function createCalendar(payload) {
    return request("/api/calendar", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateCalendar(id, payload) {
    return request(`/api/calendar/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteCalendar(id) {
    return request(`/api/calendar/${id}`, {
        method: "DELETE",
    });
}

export function getInformation() {
    return request("/api/information");
}

export function createInformation(payload) {
    return request("/api/information", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export function updateInformation(id, payload) {
    return request(`/api/information/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
}

export function deleteInformation(id) {
    return request(`/api/information/${id}`, {
        method: "DELETE",
    });
}
