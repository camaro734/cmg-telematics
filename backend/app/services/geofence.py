import math


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Returns distance in meters between two GPS coordinates."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def point_in_circle(lat: float, lng: float, center_lat: float, center_lng: float, radius_m: float) -> bool:
    """Returns True if point is inside circle."""
    return haversine_distance(lat, lng, center_lat, center_lng) <= radius_m


def point_in_polygon(lat: float, lng: float, polygon: list[dict]) -> bool:
    """
    Ray casting algorithm to check if point is inside polygon.
    polygon: list of {"lat": float, "lng": float} dicts
    """
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["lng"], polygon[i]["lat"]
        xj, yj = polygon[j]["lng"], polygon[j]["lat"]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def is_inside_geofence(lat: float, lng: float, geofence) -> bool:
    """Check if a point is inside a geofence (circle or polygon)."""
    if geofence.shape_type == "circle":
        if geofence.center_lat and geofence.center_lng and geofence.radius_m:
            return point_in_circle(lat, lng, geofence.center_lat, geofence.center_lng, geofence.radius_m)
    elif geofence.shape_type == "polygon":
        if geofence.polygon_points:
            return point_in_polygon(lat, lng, geofence.polygon_points)
    return False
