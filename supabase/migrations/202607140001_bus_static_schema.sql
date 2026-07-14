create extension if not exists pg_trgm;

create table if not exists public.bus_routes (
  city text not null,
  route_uid text not null,
  route_id text,
  route_name text not null,
  departure text,
  destination text,
  operator_name text,
  route_type integer,
  search_text text not null default '',
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_batch_id uuid not null,
  primary key (city, route_uid)
);

create table if not exists public.bus_stations (
  city text not null,
  station_key text not null,
  station_id text,
  name text not null,
  english_name text,
  latitude double precision not null,
  longitude double precision not null,
  address text,
  city_code text,
  stop_uids text[] not null default '{}',
  direction_hints text[] not null default '{}',
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_batch_id uuid not null,
  primary key (city, station_key)
);

create table if not exists public.bus_route_stops (
  city text not null,
  route_uid text not null,
  subroute_uid text not null default '',
  direction smallint not null,
  stop_sequence integer not null,
  route_name text not null,
  departure text,
  destination text,
  stop_uid text,
  stop_id text,
  station_id text,
  stop_name text not null,
  latitude double precision,
  longitude double precision,
  next_stop_uid text,
  next_stop_name text,
  heading text,
  bearing double precision,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_batch_id uuid not null,
  primary key (city, route_uid, subroute_uid, direction, stop_sequence)
);

create table if not exists public.bus_static_sync_state (
  city text primary key,
  status text not null check (status in ('running', 'success', 'failed')),
  routes_count integer not null default 0,
  stations_count integer not null default 0,
  route_stops_count integer not null default 0,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists bus_routes_search_trgm_idx
  on public.bus_routes using gin (search_text gin_trgm_ops);
create index if not exists bus_routes_name_idx
  on public.bus_routes (city, route_name);
create index if not exists bus_stations_location_idx
  on public.bus_stations (city, latitude, longitude);
create index if not exists bus_route_stops_route_idx
  on public.bus_route_stops (city, route_uid, direction, stop_sequence);
create index if not exists bus_route_stops_stop_uid_idx
  on public.bus_route_stops (city, stop_uid);
create index if not exists bus_route_stops_station_id_idx
  on public.bus_route_stops (city, station_id);

alter table public.bus_routes enable row level security;
alter table public.bus_stations enable row level security;
alter table public.bus_route_stops enable row level security;
alter table public.bus_static_sync_state enable row level security;

create or replace function public.find_nearby_bus_stations(
  p_city text,
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer default 300,
  p_limit integer default 80
)
returns table (
  station_key text,
  station_id text,
  name text,
  english_name text,
  latitude double precision,
  longitude double precision,
  address text,
  city_code text,
  stop_uids text[],
  direction_hints text[],
  distance_m double precision
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      s.*,
      6371000.0 * 2.0 * asin(
        least(1.0, sqrt(
          power(sin(radians(s.latitude - p_lat) / 2.0), 2) +
          cos(radians(p_lat)) * cos(radians(s.latitude)) *
          power(sin(radians(s.longitude - p_lon) / 2.0), 2)
        ))
      ) as calculated_distance
    from public.bus_stations s
    where s.city = p_city
      and s.latitude between p_lat - (p_radius_m / 110574.0) and p_lat + (p_radius_m / 110574.0)
      and s.longitude between p_lon - (p_radius_m / greatest(1.0, 111320.0 * cos(radians(p_lat))))
                          and p_lon + (p_radius_m / greatest(1.0, 111320.0 * cos(radians(p_lat))))
  )
  select
    c.station_key,
    c.station_id,
    c.name,
    c.english_name,
    c.latitude,
    c.longitude,
    c.address,
    c.city_code,
    c.stop_uids,
    c.direction_hints,
    c.calculated_distance
  from candidates c
  where c.calculated_distance <= p_radius_m
  order by c.calculated_distance
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on table public.bus_routes from anon, authenticated;
revoke all on table public.bus_stations from anon, authenticated;
revoke all on table public.bus_route_stops from anon, authenticated;
revoke all on table public.bus_static_sync_state from anon, authenticated;
revoke all on function public.find_nearby_bus_stations(text, double precision, double precision, integer, integer) from public, anon, authenticated;
grant execute on function public.find_nearby_bus_stations(text, double precision, double precision, integer, integer) to service_role;
