#![allow(clippy::all)]
#![allow(clippy::pedantic)]
#![allow(clippy::nursery)]
#![allow(clippy::cargo)]

pub mod thru {
    pub mod common {
        pub mod v1 {
            tonic::include_proto!("thru.common.v1");
        }
    }

    pub mod core {
        pub mod v1 {
            tonic::include_proto!("thru.core.v1");
        }
    }

    pub mod services {
        pub mod v1 {
            tonic::include_proto!("thru.services.v1");
        }
    }
}
